import {
    EditorSelection as CmSelection,
    type EditorState as CmState,
    Transaction as CmTransaction,
    Prec,
} from '@codemirror/state';
import {ViewPlugin} from '@codemirror/view';
import type {ExtensionBuilder, Parser} from '@gravity-ui/markdown-editor';
import {ensureSyntaxTree, syntaxTree} from '@gravity-ui/markdown-editor/cm/language';
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

/** Keep source selections inside code literal, including partial inline-code selections. */
function sourceInCode(state: CmState, from: number, to: number): boolean {
    const tree = ensureSyntaxTree(state, to, 100) ?? syntaxTree(state);
    let inside = false;
    tree.iterate({
        from,
        to,
        enter({node}) {
            if (inside) return false;
            if (node.name === 'InlineCode') {
                const marks = node.getChildren('CodeMark');
                inside = from >= marks[0].to && to <= marks[marks.length - 1].from;
                return false;
            }
            if (node.name === 'FencedCode') {
                const marks = node.getChildren('CodeMark');
                const start = state.doc.lineAt(marks[0].to).to + 1;
                const end =
                    marks.length > 1
                        ? state.doc.lineAt(marks[marks.length - 1].from).from
                        : node.to;
                inside = from >= start && to <= end;
                return false;
            }
            if (node.name === 'CodeBlock') {
                inside = from >= node.from && to <= node.to;
                return false;
            }
            return !inside;
        },
    });
    return inside;
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
    let plainMarkdown: (text: string) => string;
    const stripMarkdown = (text: string) => unformattedText(parser.parse(text));

    const wysiwyg = (builder: ExtensionBuilder) => {
        builder.addPlugin(({markupParser, serializer, schema}) => {
            parser = markupParser;
            // Use the same escaping as WYSIWYG's unmarked text. Raw insertion would turn
            // literal stars/brackets/headings back into formatting on the next mode switch.
            plainMarkdown = (text) =>
                text
                    .replace(/\r\n?/g, '\n')
                    .split('\n')
                    .map((line) =>
                        serializer.serialize(
                            schema.nodes.doc.create(
                                null,
                                schema.nodes.paragraph.create(
                                    null,
                                    line ? schema.text(line) : null,
                                ),
                            ),
                        ),
                    )
                    .join('\n');
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
                                              .map((range) => {
                                                  const text = state.sliceDoc(range.from, range.to);
                                                  return sourceInCode(state, range.from, range.to)
                                                      ? text
                                                      : stripMarkdown(text);
                                              })
                                              .join('\n')
                                        : null;
                                },
                                insertText: (text) =>
                                    view.dispatch({
                                        ...state.changeByRange((range) => {
                                            const insert = sourceInCode(state, range.from, range.to)
                                                ? text
                                                : plainMarkdown(text);
                                            return {
                                                changes: {from: range.from, to: range.to, insert},
                                                range: CmSelection.cursor(
                                                    range.from + insert.length,
                                                ),
                                            };
                                        }),
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
