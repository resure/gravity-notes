import {type ExtensionBuilder} from '@gravity-ui/markdown-editor';
import {type EditorState, Plugin, PluginKey} from 'prosemirror-state';
import {Decoration, DecorationSet, type EditorView} from 'prosemirror-view';

import type {NoteMeta} from '../../storage/types';
import {suggestWikiTargets} from '../../wikiLinks';

import type {WikiLinkSuggestSink} from './wikiLinkExtension';

/** How many suggestions to offer at once. */
const LIMIT = 8;

export interface WikiSuggestOptions {
    /** Schema mark name to apply on insert (the `wiki_link` mark). */
    markName: string;
    getNotes(): NoteMeta[];
    getCurrentId(): string;
    onSuggest: WikiLinkSuggestSink;
}

interface SuggestState {
    active: boolean;
    /** Doc position of the opening `[[`. */
    from: number;
    /** Caret position (end of the query). */
    to: number;
    /** Text typed after `[[`. */
    query: string;
    /** Highlighted suggestion index. */
    index: number;
    /** A `from` the user dismissed with Esc, so it won't immediately reopen at the same spot. */
    dismissedAt: number | null;
}

const EMPTY: SuggestState = {active: false, from: 0, to: 0, query: '', index: 0, dismissedAt: null};
const KEY = new PluginKey<SuggestState>('wikiLinkSuggest');

/** The `[[query` immediately before the caret, or null when the caret isn't in one. */
function triggerAt(state: EditorState): {from: number; to: number; query: string} | null {
    const {selection} = state;
    if (!selection.empty) return null;
    const $from = selection.$from;
    if ($from.parent.type.spec.code) return null; // not inside a code block
    if ($from.marks().some((mark) => mark.type.name === 'code')) return null; // nor inline code
    // Text from the block start to the caret; leaf nodes count as one char so lengths stay aligned
    // with doc positions (used to locate the `[[`).
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
    const match = /\[\[([^[\]\n]*)$/.exec(before);
    if (!match) return null;
    return {from: $from.pos - match[0].length, to: $from.pos, query: match[1]};
}

/** Replace the `[[query` span with `title` as a wiki link, leaving the caret just after it. */
function insertLink(view: EditorView, markName: string, from: number, to: number, title: string) {
    const markType = view.state.schema.marks[markName];
    const tr = view.state.tr.replaceWith(
        from,
        to,
        view.state.schema.text(title, [markType.create()]),
    );
    view.dispatch(tr.removeStoredMark(markType).scrollIntoView());
    view.focus();
}

/**
 * Wysiwyg sub-extension powering the `[[` note picker. A plugin tracks the trigger + highlighted
 * index in its state, owns the keyboard (↑/↓ move, Enter/Tab insert, Esc dismiss) so it works while
 * typing, and renders an anchor decoration; the visible popup is drawn by EditorPane from the state
 * pushed through `onSuggest`. The ranked list itself is the pure `suggestWikiTargets`.
 */
export function wikiSuggestPlugin(builder: ExtensionBuilder, opts: WikiSuggestOptions): void {
    const {markName, getNotes, getCurrentId, onSuggest} = opts;
    const items = (st: SuggestState): NoteMeta[] =>
        st.active ? suggestWikiTargets(st.query, getNotes(), getCurrentId(), LIMIT) : [];

    builder.addPlugin(
        () =>
            new Plugin<SuggestState>({
                key: KEY,
                state: {
                    init: () => EMPTY,
                    apply(tr, prev, _old, newState) {
                        const meta = tr.getMeta(KEY) as
                            | {index?: number; dismiss?: number}
                            | undefined;
                        // Arrow navigation only moves the highlight within the active trigger.
                        if (meta && typeof meta.index === 'number' && prev.active) {
                            return {...prev, index: meta.index};
                        }
                        const next = triggerAt(newState);
                        if (!next) return EMPTY;
                        let dismissedAt = prev.dismissedAt;
                        if (meta && typeof meta.dismiss === 'number') dismissedAt = meta.dismiss;
                        if (dismissedAt !== null && dismissedAt !== next.from) dismissedAt = null;
                        if (dismissedAt === next.from) {
                            return {active: false, ...next, index: 0, dismissedAt};
                        }
                        // Keep the highlight while the same `[[` is being extended; reset otherwise.
                        const index =
                            prev.active && prev.from === next.from && prev.query === next.query
                                ? prev.index
                                : 0;
                        return {active: true, ...next, index, dismissedAt: null};
                    },
                },
                props: {
                    decorations(state) {
                        const st = KEY.getState(state);
                        if (!st?.active) return null;
                        // The anchor element the popup attaches to (wraps the `[[query`).
                        return DecorationSet.create(state.doc, [
                            Decoration.inline(st.from, st.to, {
                                nodeName: 'span',
                                class: 'wiki-suggest',
                            }),
                        ]);
                    },
                    handleKeyDown(view, event) {
                        const st = KEY.getState(view.state);
                        if (!st?.active) return false;
                        if (event.key === 'Escape') {
                            view.dispatch(view.state.tr.setMeta(KEY, {dismiss: st.from}));
                            return true;
                        }
                        const list = items(st);
                        if (list.length === 0) return false; // nothing to pick — let the key through
                        if (event.key === 'ArrowDown') {
                            view.dispatch(
                                view.state.tr.setMeta(KEY, {index: (st.index + 1) % list.length}),
                            );
                            return true;
                        }
                        if (event.key === 'ArrowUp') {
                            view.dispatch(
                                view.state.tr.setMeta(KEY, {
                                    index: (st.index - 1 + list.length) % list.length,
                                }),
                            );
                            return true;
                        }
                        if (event.key === 'Enter' || event.key === 'Tab') {
                            const note = list[Math.min(st.index, list.length - 1)];
                            if (note) insertLink(view, markName, st.from, st.to, note.title);
                            return true;
                        }
                        return false;
                    },
                },
                view(editorView) {
                    const push = () => {
                        const st = KEY.getState(editorView.state);
                        const list = st ? items(st) : [];
                        const anchor = editorView.dom.querySelector('.wiki-suggest');
                        if (!st?.active || list.length === 0 || !(anchor instanceof HTMLElement)) {
                            onSuggest(null);
                            return;
                        }
                        onSuggest({
                            items: list,
                            activeIndex: Math.min(st.index, list.length - 1),
                            anchor,
                            choose: (i) => {
                                const note = list[i];
                                if (note)
                                    insertLink(editorView, markName, st.from, st.to, note.title);
                            },
                            close: () =>
                                editorView.dispatch(
                                    editorView.state.tr.setMeta(KEY, {dismiss: st.from}),
                                ),
                        });
                    };
                    push();
                    return {update: push, destroy: () => onSuggest(null)};
                },
            }),
        builder.Priority.VeryHigh,
    );
}
