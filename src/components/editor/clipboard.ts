import {Transaction as CmTransaction, Prec} from '@codemirror/state';
import {ViewPlugin} from '@codemirror/view';
import type {ExtensionBuilder, Parser} from '@gravity-ui/markdown-editor';
import {Fragment, type Node, Slice} from 'prosemirror-model';
import {Plugin, PluginKey} from 'prosemirror-state';
import type {EditorView} from 'prosemirror-view';

import {readClipboardText, writeClipboardText} from '../../clipboard';

const TEXT = 'text/plain';
const MARKDOWN = 'text/yfm'; // Gravity's selection serializer already handles lists/tables/marks.
const clipboardPluginKey = new PluginKey('gravityMarkdownClipboard');

/** Render the parsed content as text, including image labels and explicit line breaks. */
export function unformattedText(node: Node): string {
    return textFromFragment(node.content);
}

function textFromFragment(content: Fragment): string {
    return content.textBetween(0, content.size, '\n\n', (leaf) => {
        if (leaf.type.spec.isBreak || /^(hard_break|soft_break|br)$/.test(leaf.type.name)) {
            return '\n';
        }
        return typeof leaf.attrs.alt === 'string' ? leaf.attrs.alt : '';
    });
}

/** Change the public clipboard representation after Gravity has serialized the selection. */
export function exposeMarkdown(event: ClipboardEvent): void {
    const data = event.clipboardData;
    if (!data || !event.defaultPrevented) return;
    const markdown = data.getData(MARKDOWN);
    if (!markdown) return; // Code selections are already literal plain text.
    data.clearData();
    data.setData(TEXT, markdown);
    data.setData(MARKDOWN, markdown);
}

interface PlainClipboardTarget {
    selectedText(): string | null;
    insertText(text: string): void;
    isCurrent(): boolean;
}

/** Async clipboard reads must never land in a new note, selection, or editing session. */
export function plainClipboardKey(
    event: KeyboardEvent,
    target: PlainClipboardTarget,
    stripMarkdown: (text: string) => string,
    onError: (message: string) => void,
): boolean {
    if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return false;
    const key = event.code || event.key.toLowerCase();
    const copy = key === 'KeyC' || key === 'c';
    if (!copy && key !== 'KeyV' && key !== 'v') return false;
    event.preventDefault();
    event.stopPropagation();
    if (copy) {
        const text = target.selectedText();
        if (text !== null) {
            try {
                void writeClipboardText(text).catch(() =>
                    onError('Could not copy plain text. Check clipboard access.'),
                );
            } catch {
                onError('Could not copy plain text. Check clipboard access.');
            }
        }
    } else {
        // Call in the key gesture itself (Safari/WKWebView require user activation).
        try {
            void readClipboardText()
                .then(
                    (text) => {
                        if (text && target.isCurrent()) {
                            const plain = stripMarkdown(text);
                            if (plain) target.insertText(plain);
                        }
                    },
                    () => onError('Could not paste plain text. Check clipboard access.'),
                )
                .catch(() => onError('Could not convert the clipboard to plain text.'));
        } catch {
            onError('Could not paste plain text. Check clipboard access.');
        }
    }
    return true;
}

function inCode(view: EditorView): boolean {
    const {selection, storedMarks} = view.state;
    return Boolean(
        selection.$from.parent.type.spec.code ||
        (storedMarks ?? selection.$from.marks()).some((mark) => mark.type.spec.code),
    );
}

export function insertUnformattedText(view: EditorView, text: string): void {
    if (!text) return;
    const {schema, tr} = view.state;
    if (inCode(view)) {
        tr.replaceSelectionWith(schema.text(text), true);
    } else {
        // A real text slice, without inherited bold/link marks or Markdown parsing.
        const content: Node[] = [];
        text.replace(/\r\n?/g, '\n')
            .split('\n')
            .forEach((line, index) => {
                if (index) content.push(schema.nodes.soft_break.create());
                if (line) content.push(schema.text(line));
            });
        tr.replaceSelection(
            new Slice(Fragment.from(schema.nodes.paragraph.create(null, content)), 1, 1),
        );
    }
    view.dispatch(tr.scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'));
}

/** One parser shared by both modes; it includes the app's Markdown extensions. */
export function createClipboardExtensions(onError: (message: string) => void) {
    let parser: Parser;
    const stripMarkdown = (text: string) => unformattedText(parser.parse(text));

    const wysiwyg = (builder: ExtensionBuilder) => {
        builder.addPlugin(({markupParser}) => {
            parser = markupParser;
            let alive = false;
            return new Plugin({
                key: clipboardPluginKey,
                view(view) {
                    alive = true;
                    // PM's native copy/cut listener runs first, including Gravity's sophisticated
                    // selection serializer. Reuse its Markdown instead of approximating slices.
                    view.dom.addEventListener('copy', exposeMarkdown);
                    view.dom.addEventListener('cut', exposeMarkdown);
                    return {
                        destroy() {
                            alive = false;
                            view.dom.removeEventListener('copy', exposeMarkdown);
                            view.dom.removeEventListener('cut', exposeMarkdown);
                        },
                    };
                },
                props: {
                    handleDOMEvents: {
                        keydown(view, event) {
                            const state = view.state;
                            return plainClipboardKey(
                                event,
                                {
                                    selectedText: () =>
                                        state.selection.empty
                                            ? null
                                            : textFromFragment(state.selection.content().content),
                                    insertText: (text) => insertUnformattedText(view, text),
                                    isCurrent: () =>
                                        alive && view.hasFocus() && view.state === state,
                                },
                                stripMarkdown,
                                onError,
                            );
                        },
                        paste(view, event) {
                            const data = event.clipboardData;
                            // Leave images and rich HTML to Gravity's existing paste/upload flow.
                            // The Highest-priority code plugin also retains literal code pasting.
                            if (!data || data.files.length || inCode(view)) return false;
                            const markdown = data.getData(MARKDOWN);
                            if (!markdown && data.getData('text/html')) return false;
                            const text = markdown || data.getData(TEXT);
                            if (!text) return false;
                            const content = markupParser.parse(text).content;
                            const openStart = content.firstChild?.isTextblock ? 1 : 0;
                            const openEnd = openStart && content.childCount === 1 ? 1 : 0;
                            view.dispatch(
                                view.state.tr
                                    .replaceSelection(new Slice(content, openStart, openEnd))
                                    .scrollIntoView()
                                    .setMeta('paste', true)
                                    .setMeta('uiEvent', 'paste'),
                            );
                            event.preventDefault();
                            return true;
                        },
                    },
                },
            });
        }, builder.Priority.VeryHigh);
    };

    const markup = Prec.highest(
        ViewPlugin.define(
            () => {
                let alive = true;
                return {
                    destroy() {
                        alive = false;
                    },
                    isAlive: () => alive,
                };
            },
            {
                eventHandlers: {
                    keydown(event, view) {
                        const state = view.state;
                        return plainClipboardKey(
                            event,
                            {
                                selectedText: () => {
                                    const ranges = state.selection.ranges.filter(
                                        (range) => !range.empty,
                                    );
                                    return ranges.length
                                        ? ranges
                                              .map((range) =>
                                                  stripMarkdown(
                                                      state.sliceDoc(range.from, range.to),
                                                  ),
                                              )
                                              .join('\n')
                                        : null;
                                },
                                insertText: (text) =>
                                    view.dispatch({
                                        ...state.replaceSelection(text),
                                        annotations: CmTransaction.userEvent.of('input.paste'),
                                        scrollIntoView: true,
                                    }),
                                isCurrent: () =>
                                    this.isAlive() && view.hasFocus && view.state === state,
                            },
                            stripMarkdown,
                            onError,
                        );
                    },
                },
            },
        ),
    );

    return {wysiwyg, markup};
}
