import {type ExtensionBuilder} from '@gravity-ui/markdown-editor';
import {InputRule} from 'prosemirror-inputrules';
import type {Node as ProseMirrorNode} from 'prosemirror-model';
import {type EditorState, Plugin, PluginKey, TextSelection} from 'prosemirror-state';
import {Decoration, DecorationSet, type EditorView} from 'prosemirror-view';

import type {NoteMeta} from '../../storage/types';
import {resolveWikiLink} from '../../wikiLinks';

import {wikiSuggestPlugin} from './wikiSuggest';

/**
 * ProseMirror mark name for a `[[wiki link]]`. The marked text is the link *title*; it serializes
 * straight back to `[[title]]` (raw, `escape: false`, so a title like `to_do` round-trips intact).
 * Behaves like the editor's URL links: rendered as an `<a>` (no brackets), ⌘/Ctrl-click follows it,
 * a plain click edits the text inline.
 */
export const WIKI_LINK_MARK = 'wiki_link';

export interface WikiLinkOptions {
    /** Latest notes list — for resolving a target to an id (broken-state styling + ⌘-click follow). */
    getNotes(): NoteMeta[];
    /** Id of the note being edited — for same-folder resolution. */
    getCurrentId(): string;
    /** Follow a `[[link]]` (⌘/Ctrl-click): Workspace resolves the title + opens it (creating if missing). */
    onOpen(target: string): void;
    /** Receives the live EditorView so decorations can be refreshed when the notes list changes. */
    viewRef?: {current: EditorView | null};
    /** Drive the `[[` autocomplete popup (state pushed up to EditorPane to render). */
    onSuggest?: WikiLinkSuggestSink;
    /** Drive the edit tooltip shown while the caret sits in a link (state pushed up to EditorPane). */
    onTooltip?: WikiLinkTooltipSink;
}

/** A snapshot the editor pushes to EditorPane to render the `[[` suggestion popup, or null to hide it. */
export type WikiLinkSuggestSink = (state: WikiLinkSuggestState | null) => void;

export interface WikiLinkSuggestState {
    /** Notes to offer, already ranked (best first). */
    items: NoteMeta[];
    /** Index of the highlighted item. */
    activeIndex: number;
    /** The on-screen `[[…` element to anchor the popup to. */
    anchor: HTMLElement;
    /** Insert the item at `index` as a link (mouse pick). */
    choose(index: number): void;
    /** Dismiss the popup. */
    close(): void;
}

/** A snapshot EditorPane renders as the edit tooltip while the caret is in a link, or null to hide it. */
export type WikiLinkTooltipSink = (state: WikiLinkTooltipState | null) => void;

export interface WikiLinkTooltipState {
    /** The `<a>` element to anchor the tooltip to. */
    anchor: HTMLElement;
    /** The link's current target/text. */
    target: string;
    /** Whether the target resolves to a note (false → following it would create the note). */
    broken: boolean;
    /** Follow the link — open the note (creating it if missing). */
    open(): void;
    /** Replace the link's text + mark with `next`, re-targeting it. */
    setTarget(next: string): void;
    /** Strip the link mark, leaving the text as plain text. */
    unlink(): void;
    /** Return keyboard focus to the editor (the caret stays put). */
    refocus(): void;
}

/** PluginKey for the broken-link decorations, so EditorPane can nudge a refresh on notes changes. */
const BROKEN_KEY = new PluginKey<DecorationSet>('wikiLinkBroken');

/** The `<a class="wiki-link">` under a mouse event, if any. */
function wikiAnchor(event: MouseEvent): HTMLElement | null {
    const target = event.target as HTMLElement | null;
    const anchor = target?.closest('a.wiki-link');
    return anchor instanceof HTMLElement ? anchor : null;
}

/** The contiguous `[[wiki link]]` mark range touched by a collapsed caret, or null. */
function wikiLinkRange(state: EditorState): {from: number; to: number; target: string} | null {
    const sel = state.selection;
    if (!sel.empty) return null;
    const markType = state.schema.marks[WIKI_LINK_MARK];
    if (!markType) return null;
    const $pos = sel.$from;
    if (!$pos.parent.isTextblock) return null;
    const pos = sel.from;
    const base = $pos.start();
    let hit: {from: number; to: number} | null = null;
    let run: {from: number; to: number} | null = null;
    $pos.parent.forEach((child, offset) => {
        const from = base + offset;
        const to = from + child.nodeSize;
        if (child.isText && markType.isInSet(child.marks)) {
            if (run && run.to === from)
                run.to = to; // extend the contiguous run in place
            else run = {from, to};
            if (pos >= run.from && pos <= run.to) hit = run; // caret touches this run (incl. edges)
        } else {
            run = null;
        }
    });
    if (!hit) return null;
    const range: {from: number; to: number} = hit;
    return {from: range.from, to: range.to, target: state.doc.textBetween(range.from, range.to)};
}

/** The rendered `<a class="wiki-link">` element for the link starting at `from`, if reachable. */
function wikiAnchorAt(view: EditorView, from: number): HTMLElement | null {
    const {node} = view.domAtPos(from + 1); // a position inside the link's text
    const el = node instanceof HTMLElement ? node : node.parentElement;
    return el?.closest('a.wiki-link') ?? null;
}

/** Strip the wiki-link mark over `[from,to]`, keeping the text; caret lands at the end. */
function unlinkWikiLink(view: EditorView, from: number, to: number): void {
    const markType = view.state.schema.marks[WIKI_LINK_MARK];
    const tr = view.state.tr.removeMark(from, to, markType);
    tr.setSelection(TextSelection.create(tr.doc, to));
    view.dispatch(tr);
    view.focus();
}

/** Replace the link over `[from,to]` with `target` (re-marked); empty target unlinks it instead. */
function replaceWikiLink(view: EditorView, from: number, to: number, target: string): void {
    const next = target.trim();
    if (!next) {
        unlinkWikiLink(view, from, to);
        return;
    }
    const markType = view.state.schema.marks[WIKI_LINK_MARK];
    const tr = view.state.tr.replaceWith(
        from,
        to,
        view.state.schema.text(next, [markType.create()]),
    );
    tr.setSelection(TextSelection.create(tr.doc, from + next.length));
    tr.removeStoredMark(markType);
    view.dispatch(tr.scrollIntoView());
    view.focus();
}

/** Recompute which `[[links]]` in the doc don't resolve, decorating them with a broken-state class. */
function computeBroken(doc: ProseMirrorNode, opts: WikiLinkOptions): DecorationSet {
    const notes = opts.getNotes();
    const currentId = opts.getCurrentId();
    const decorations: Decoration[] = [];
    doc.descendants((node, pos) => {
        if (!node.isText || !node.text) return;
        if (!node.marks.some((mark) => mark.type.name === WIKI_LINK_MARK)) return;
        if (resolveWikiLink(node.text, currentId, notes) === null) {
            decorations.push(
                Decoration.inline(pos, pos + node.nodeSize, {class: 'wiki-link_broken'}),
            );
        }
    });
    return DecorationSet.create(doc, decorations);
}

/**
 * Ask the editor to re-evaluate which `[[links]]` are broken — call after the notes list (or the open
 * note's id) changes, since that can flip a link between resolved and broken without a doc edit.
 */
export function refreshWikiLinks(view: EditorView | null | undefined): void {
    if (!view) return;
    view.dispatch(view.state.tr.setMeta(BROKEN_KEY, true));
}

/**
 * Wysiwyg extension: `[[wiki links]]` between notes. Wires the markdown round-trip (a markdown-it
 * inline rule + a `wiki_link` mark + a raw `[[`/`]]` serializer), a live input rule (`[[Title]]` →
 * link as you type the closing `]]`), ⌘/Ctrl-click to follow a link, a broken-state decoration for
 * targets that don't resolve, and the `[[` suggestion popup.
 */
export function wikiLinkExtension(builder: ExtensionBuilder, opts: WikiLinkOptions): void {
    builder
        .configureMd((md) => {
            // Tokenize `[[title]]` into the open/text/close trio the mark parser expects. Runs before
            // the link rule so `[[` is claimed here, never mistaken for the start of `[text](url)`.
            md.inline.ruler.before('link', WIKI_LINK_MARK, (state, silent) => {
                const {src, posMax} = state;
                const start = state.pos;
                if (src.charCodeAt(start) !== 0x5b /* [ */ || src.charCodeAt(start + 1) !== 0x5b) {
                    return false;
                }
                let end = -1;
                for (let i = start + 2; i < posMax - 1; i++) {
                    const code = src.charCodeAt(i);
                    if (code === 0x0a /* \n */ || code === 0x5b /* [ */) return false;
                    if (code === 0x5d /* ] */) {
                        if (src.charCodeAt(i + 1) === 0x5d) {
                            end = i;
                            break;
                        }
                        return false; // a lone ] inside → not a wiki link
                    }
                }
                if (end === -1) return false;
                const content = src.slice(start + 2, end);
                if (!content.trim()) return false;
                if (!silent) {
                    const open = state.push(`${WIKI_LINK_MARK}_open`, 'a', 1);
                    open.markup = '[[';
                    const text = state.push('text', '', 0);
                    text.content = content;
                    const close = state.push(`${WIKI_LINK_MARK}_close`, 'a', -1);
                    close.markup = ']]';
                }
                // eslint-disable-next-line no-param-reassign -- markdown-it rules advance via state.pos
                state.pos = end + 2;
                return true;
            });
            return md;
        })
        .addMark(WIKI_LINK_MARK, () => ({
            spec: {
                inclusive: false, // typing past a link's edge doesn't extend it — like the URL link mark
                parseDOM: [{tag: 'a.wiki-link'}],
                toDOM() {
                    // No href: the editor's generic ⌘-click-link handler ignores it, leaving the
                    // dedicated wiki handler below to follow it to a note.
                    return ['a', {class: 'wiki-link'}];
                },
            },
            // Raw `[[`/`]]` with no inner escaping, so a title carrying `_`, `~`, `` ` `` round-trips.
            toMd: {
                open: '[[',
                close: ']]',
                mixable: false,
                expelEnclosingWhitespace: true,
                escape: false,
            },
            fromMd: {tokenSpec: {name: WIKI_LINK_MARK, type: 'mark'}},
        }));

    // Live typing: turn `[[Title]]` into a link the moment the closing `]]` is typed (spaces allowed
    // in the title, unlike the package's markInputRule). Mirrors what the markdown parser does on load.
    builder.addInputRules(({schema}) => {
        const markType = schema.marks[WIKI_LINK_MARK];
        return {
            rules: [
                new InputRule(/\[\[([^[\]\n]+)\]\]$/, (state, match, start, end) => {
                    const title = match[1];
                    if (!title.trim()) return null;
                    const tr = state.tr.replaceWith(
                        start,
                        end,
                        schema.text(title, [markType.create()]),
                    );
                    return tr.removeStoredMark(markType);
                }),
            ],
        };
    });

    // ⌘/Ctrl-click follows a link (like the URL-link handler); a plain click edits the text inline.
    builder.addPlugin(
        () =>
            new Plugin({
                props: {
                    handleDOMEvents: {
                        mousedown(_view, event) {
                            if ((event.metaKey || event.ctrlKey) && wikiAnchor(event)) {
                                event.preventDefault(); // block caret placement so the tooltip stays shut
                                return true;
                            }
                            return false;
                        },
                        click(_view, event) {
                            if (!event.metaKey && !event.ctrlKey) return false;
                            const anchor = wikiAnchor(event);
                            if (!anchor) return false;
                            event.preventDefault();
                            opts.onOpen(anchor.textContent ?? '');
                            return true;
                        },
                    },
                },
            }),
        builder.Priority.VeryHigh,
    );

    // Broken-link styling: decorate any `[[link]]` whose target doesn't resolve. Recomputed on doc
    // changes and on an explicit nudge (refreshWikiLinks) when the notes list/open-note id changes.
    builder.addPlugin(
        () =>
            new Plugin<DecorationSet>({
                key: BROKEN_KEY,
                view(editorView) {
                    const {viewRef} = opts;
                    if (viewRef) viewRef.current = editorView;
                    return {
                        destroy() {
                            if (viewRef) viewRef.current = null;
                        },
                    };
                },
                state: {
                    init: (_config, state) => computeBroken(state.doc, opts),
                    apply(tr, value, _old, newState) {
                        if (tr.docChanged || tr.getMeta(BROKEN_KEY)) {
                            return computeBroken(newState.doc, opts);
                        }
                        return value.map(tr.mapping, tr.doc);
                    },
                },
                props: {
                    decorations(state) {
                        return BROKEN_KEY.getState(state);
                    },
                },
            }),
        builder.Priority.Low,
    );

    // Edit tooltip: while the caret sits in a link, push its details up so EditorPane can offer
    // open / re-target / unlink — the wiki-link counterpart of the editor's URL-link tooltip.
    if (opts.onTooltip) {
        const onTooltip = opts.onTooltip;
        builder.addPlugin(
            () =>
                new Plugin({
                    view(editorView) {
                        const push = () => {
                            const range = wikiLinkRange(editorView.state);
                            const anchor = range && wikiAnchorAt(editorView, range.from);
                            if (!range || !anchor) {
                                onTooltip(null);
                                return;
                            }
                            onTooltip({
                                anchor,
                                target: range.target,
                                broken:
                                    resolveWikiLink(
                                        range.target,
                                        opts.getCurrentId(),
                                        opts.getNotes(),
                                    ) === null,
                                open: () => opts.onOpen(range.target),
                                setTarget: (next) =>
                                    replaceWikiLink(editorView, range.from, range.to, next),
                                unlink: () => unlinkWikiLink(editorView, range.from, range.to),
                                refocus: () => editorView.focus(),
                            });
                        };
                        push();
                        return {update: push, destroy: () => onTooltip(null)};
                    },
                }),
            builder.Priority.Low,
        );
    }

    // The `[[` autocomplete popup (note picker). Kept in its own module; no-op when no sink is wired.
    if (opts.onSuggest) {
        wikiSuggestPlugin(builder, {
            markName: WIKI_LINK_MARK,
            getNotes: opts.getNotes,
            getCurrentId: opts.getCurrentId,
            onSuggest: opts.onSuggest,
        });
    }
}
