import {forwardRef, useEffect, useImperativeHandle, useRef} from 'react';

import {closeBrackets, closeBracketsKeymap} from '@codemirror/autocomplete';
import {defaultKeymap, history, historyKeymap, indentWithTab} from '@codemirror/commands';
import {markdown, markdownKeymap, markdownLanguage} from '@codemirror/lang-markdown';
import {HighlightStyle, bracketMatching, syntaxHighlighting} from '@codemirror/language';
import {languages} from '@codemirror/language-data';
import {highlightSelectionMatches, search, searchKeymap} from '@codemirror/search';
import {Compartment, EditorState} from '@codemirror/state';
import {
    Decoration,
    type DecorationSet,
    EditorView,
    type KeyBinding,
    MatchDecorator,
    ViewPlugin,
    type ViewUpdate,
    drawSelection,
    keymap,
} from '@codemirror/view';
import {tags} from '@lezer/highlight';

import {GLOBAL_CHORDS, normalizeChord} from '../shortcuts';

import type {SourceHandle, SourceSurfaceProps} from './SourceSurface';
import {replaceSourceText} from './SourceSurface';

// The app's global chords win: CodeMirror's defaults include ⌘/ (help here), ⌘⇧\ (the folder
// rail)…
function withoutAppChords(bindings: readonly KeyBinding[]): KeyBinding[] {
    return bindings.filter(({key, mac}) => {
        const binding = mac ?? key;
        if (!binding) return true;
        // `Mod-[` splits on its own dash only; a key that IS a dash would be the trailing empty part.
        const keys = binding.split(/-(?!$)/);
        return !GLOBAL_CHORDS.has(normalizeChord(keys));
    });
}

const markdownStyle = HighlightStyle.define([
    {tag: tags.heading, fontWeight: '700', color: 'var(--text-1)'},
    {tag: tags.strong, fontWeight: '700'},
    {tag: tags.emphasis, fontStyle: 'italic'},
    {tag: tags.strikethrough, textDecoration: 'line-through'},
    {tag: [tags.link, tags.url], color: 'var(--link)'},
    {tag: tags.monospace, color: 'var(--yfm-color-hljs-deletion, #880000)'},
    {tag: tags.quote, color: 'var(--text-2)'},
    {
        tag: [tags.processingInstruction, tags.meta, tags.contentSeparator],
        color: 'var(--text-3)',
    },
    // Fenced code, in the preview's palette.
    {tag: tags.comment, color: 'var(--yfm-color-hljs-comment, #888888)'},
    {
        tag: [tags.string, tags.number, tags.typeName, tags.regexp],
        color: 'var(--yfm-color-hljs-deletion, #880000)',
    },
    {
        tag: [tags.function(tags.variableName), tags.className, tags.definition(tags.variableName)],
        color: 'var(--yfm-color-hljs-section, #880000)',
    },
    {tag: [tags.bool, tags.null, tags.atom], color: 'var(--yfm-color-hljs-literal, #78a960)'},
    {tag: [tags.keyword, tags.operatorKeyword], fontWeight: '700'},
    {tag: tags.standard(tags.variableName), color: 'var(--yfm-color-hljs-addition, #397300)'},
    {tag: [tags.annotation, tags.attributeName], color: 'var(--yfm-color-hljs-meta, #1f7199)'},
]);

const wikiLinks = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;
        private matcher = new MatchDecorator({
            regexp: /\[\[[^[\]\n]+\]\]/g,
            decoration: Decoration.mark({class: 'cm-wiki-link'}),
        });

        constructor(view: EditorView) {
            this.decorations = this.matcher.createDeco(view);
        }

        update(update: ViewUpdate) {
            this.decorations = this.matcher.updateDeco(update, this.decorations);
        }
    },
    {decorations: (plugin) => plugin.decorations},
);

const theme = (plainText: boolean) =>
    EditorView.theme({
        '&': {
            color: 'var(--text-1)',
            backgroundColor: 'transparent',
            fontSize: plainText ? 'var(--gn-editor-font-size, 15px)' : '14px',
        },
        '&.cm-focused': {outline: 'none'},
        // The PANE scrolls source mode, exactly as it scrolls the blocks: no inner scrollbar.
        '.cm-scroller': {
            overflow: 'visible',
            fontFamily: plainText ? 'var(--gn-editor-font, var(--font-ui))' : 'var(--font-mono)',
            lineHeight: plainText ? 'var(--gn-editor-line-height, 1.6)' : '1.6',
        },
        '.cm-content': {
            minHeight: '60vh',
            padding: '4px 0 30vh',
            caretColor: 'var(--text-1)',
        },
        '.cm-line': {
            padding: plainText
                ? '0 calc(var(--editor-gutter, 16px) + 4px)'
                : '0 var(--editor-gutter, 16px)',
        },
        '.cm-cursor': {borderLeftColor: 'var(--text-1)'},
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
            backgroundColor: 'var(--accent-selection) !important',
        },
        '.cm-selectionMatch': {backgroundColor: 'var(--bg-hover)'},
        '.cm-matchingBracket': {backgroundColor: 'var(--bg-hover)', outline: 'none'},
        '.cm-wiki-link': {color: 'var(--link)'},
        '.cm-searchMatch': {backgroundColor: 'var(--accent-selection)'},
        '.cm-searchMatch-selected': {backgroundColor: 'var(--accent-strong-wash)'},
        '.cm-panels': {
            backgroundColor: 'var(--bg-paper)',
            color: 'var(--text-1)',
        },
        '.cm-panels-bottom': {borderTop: '1px solid var(--line)'},
        '.cm-panels-top': {borderBottom: '1px solid var(--line)'},
        '.cm-textfield': {
            backgroundColor: 'var(--bg-hover)',
            border: '1px solid var(--line)',
            borderRadius: '4px',
            color: 'inherit',
        },
        '.cm-button': {
            backgroundImage: 'none',
            backgroundColor: 'var(--bg-hover)',
            border: '1px solid var(--line)',
            borderRadius: '4px',
            color: 'inherit',
        },
    });

function emptyFirstLine(view: EditorView): boolean {
    const {main} = view.state.selection;
    return main.empty && main.head === 0 && view.state.doc.line(1).length === 0;
}

const SourceEditor = forwardRef<SourceHandle, SourceSurfaceProps>(function SourceEditor(
    {readValue, onChange, focusOnMount, plainText = false},
    ref,
) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    // Whether Backspace began on an empty first line. The pane asks after CodeMirror has already
    // handled the key, and a select-all + Backspace would otherwise read as "leave for the title".
    const emptyBeforeKeyRef = useRef<boolean | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return undefined;
        let text = readValue();
        // Settings › Check spelling is an attribute on the pane, which the textarea simply inherited.
        const spellcheckHost = host.closest('[spellcheck]');
        const spellcheck = new Compartment();
        const spellcheckAttribute = () =>
            EditorView.contentAttributes.of({
                spellcheck: spellcheckHost?.getAttribute('spellcheck') ?? 'false',
            });
        const view = new EditorView({
            parent: host,
            state: EditorState.create({
                doc: text,
                extensions: [
                    history(),
                    drawSelection(),
                    EditorState.allowMultipleSelections.of(true),
                    EditorView.lineWrapping,
                    ...(plainText ? [] : [closeBrackets(), bracketMatching()]),
                    highlightSelectionMatches(),
                    search({top: true}),
                    ...(plainText
                        ? []
                        : [
                              markdown({base: markdownLanguage, codeLanguages: languages}),
                              syntaxHighlighting(markdownStyle),
                              wikiLinks,
                          ]),
                    theme(plainText),
                    EditorView.contentAttributes.of({
                        'aria-label': plainText ? 'Plain text' : 'Markdown source',
                    }),
                    spellcheck.of(spellcheckAttribute()),
                    keymap.of(
                        withoutAppChords([
                            ...(plainText ? [] : [...closeBracketsKeymap, ...markdownKeymap]),
                            ...defaultKeymap,
                            ...searchKeymap,
                            ...historyKeymap,
                            indentWithTab,
                        ]),
                    ),
                    EditorView.updateListener.of((update) => {
                        if (!update.docChanged) return;
                        if (plainText) {
                            const changes: {from: number; to: number; insert: string}[] = [];
                            update.changes.iterChanges((from, to, _from, _to, inserted) => {
                                changes.push({from, to, insert: inserted.toString()});
                            });
                            for (const change of changes.reverse()) {
                                text = replaceSourceText(
                                    text,
                                    change.from,
                                    change.to,
                                    change.insert,
                                );
                            }
                        } else {
                            text = update.state.doc.toString();
                        }
                        onChangeRef.current(text);
                    }),
                ],
            }),
        });
        viewRef.current = view;
        if (focusOnMount?.current) view.focus();
        if (focusOnMount) focusOnMount.current = false;

        const spellcheckChanges = new MutationObserver(() =>
            view.dispatch({effects: spellcheck.reconfigure(spellcheckAttribute())}),
        );
        if (spellcheckHost) {
            spellcheckChanges.observe(spellcheckHost, {attributeFilter: ['spellcheck']});
        }
        const recordBackspace = (event: KeyboardEvent) => {
            if (event.key !== 'Backspace') return;
            emptyBeforeKeyRef.current = emptyFirstLine(view);
            window.setTimeout(() => {
                emptyBeforeKeyRef.current = null;
            }, 0);
        };
        host.addEventListener('keydown', recordBackspace, true);
        return () => {
            host.removeEventListener('keydown', recordBackspace, true);
            spellcheckChanges.disconnect();
            view.destroy();
            viewRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the text is read once, at mount
    }, []);

    useImperativeHandle(ref, () => ({
        focus: () => viewRef.current?.focus(),
        blur: () => viewRef.current?.contentDOM.blur(),
        moveCursor(to) {
            const view = viewRef.current;
            if (!view) return;
            const at = to === 'start' ? 0 : view.state.doc.length;
            view.dispatch({selection: {anchor: at}});
        },
        atEmptyFirstLine() {
            const view = viewRef.current;
            if (!view?.hasFocus) return false;
            return emptyBeforeKeyRef.current ?? emptyFirstLine(view);
        },
    }));

    return <div ref={hostRef} className="block-editor-codemirror" />;
});

export default SourceEditor;
