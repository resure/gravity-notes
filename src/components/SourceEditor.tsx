import {forwardRef, useEffect, useImperativeHandle, useRef} from 'react';

import {closeBrackets, closeBracketsKeymap} from '@codemirror/autocomplete';
import {defaultKeymap, history, historyKeymap, indentWithTab} from '@codemirror/commands';
import {markdown, markdownKeymap, markdownLanguage} from '@codemirror/lang-markdown';
import {HighlightStyle, bracketMatching, syntaxHighlighting} from '@codemirror/language';
import {languages} from '@codemirror/language-data';
import {highlightSelectionMatches, search, searchKeymap} from '@codemirror/search';
import {EditorState} from '@codemirror/state';
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

import {SHORTCUTS} from '../shortcuts';

import {type SourceHandle, type SourceSurfaceProps, fallbackFocus} from './SourceSurface';

const chord = (keys: string[]) =>
    keys
        .map((key) => key.toLowerCase())
        .map((key) => ({arrowup: 'up', arrowdown: 'down', cmd: 'mod', meta: 'mod'})[key] ?? key)
        .sort()
        .join('+');

// The app's global chords win: CodeMirror's defaults include ⌘/ (help here), ⌘⇧\ (the folder
// rail)… Only chords with a modifier are given up — Enter and Tab stay the editor's.
const APP_CHORDS = new Set(
    SHORTCUTS.filter((shortcut) => shortcut.global)
        .flatMap((shortcut) => shortcut.keys.split(' '))
        .filter((keys) => /\b(mod|alt|ctrl)\+/.test(keys))
        .map((keys) => chord(keys.split('+'))),
);

function withoutAppChords(bindings: readonly KeyBinding[]): KeyBinding[] {
    return bindings.filter(({key, mac}) => {
        const binding = mac ?? key;
        if (!binding) return true;
        // `Mod-[` splits on its own dash only; a key that IS a dash would be the trailing empty part.
        const keys = binding.split(/-(?!$)/);
        return !APP_CHORDS.has(chord(keys));
    });
}

const markdownStyle = HighlightStyle.define([
    {tag: tags.heading, fontWeight: '700', color: 'var(--g-color-text-primary)'},
    {tag: tags.strong, fontWeight: '700'},
    {tag: tags.emphasis, fontStyle: 'italic'},
    {tag: tags.strikethrough, textDecoration: 'line-through'},
    {tag: [tags.link, tags.url], color: 'var(--g-color-text-link)'},
    {tag: tags.monospace, color: 'var(--yfm-color-hljs-deletion, #880000)'},
    {tag: tags.quote, color: 'var(--g-color-text-secondary)'},
    {
        tag: [tags.processingInstruction, tags.meta, tags.contentSeparator],
        color: 'var(--g-color-text-hint)',
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

const theme = EditorView.theme({
    '&': {
        color: 'var(--g-color-text-primary)',
        backgroundColor: 'transparent',
        fontSize: '14px',
    },
    '&.cm-focused': {outline: 'none'},
    // The PANE scrolls source mode, exactly as it scrolls the blocks: no inner scrollbar.
    '.cm-scroller': {
        overflow: 'visible',
        fontFamily: 'var(--g-font-family-monospace)',
        lineHeight: '1.6',
    },
    '.cm-content': {
        minHeight: '60vh',
        padding: '4px 0 30vh',
        caretColor: 'var(--g-color-text-primary)',
    },
    '.cm-line': {padding: '0 var(--editor-gutter, 16px)'},
    '.cm-cursor': {borderLeftColor: 'var(--g-color-text-primary)'},
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
        backgroundColor: 'var(--g-color-base-selection) !important',
    },
    '.cm-selectionMatch': {backgroundColor: 'var(--g-color-base-simple-hover)'},
    '.cm-matchingBracket': {backgroundColor: 'var(--g-color-base-simple-hover)', outline: 'none'},
    '.cm-wiki-link': {color: 'var(--g-color-text-link)'},
    '.cm-searchMatch': {backgroundColor: 'var(--g-color-base-warning-medium)'},
    '.cm-searchMatch-selected': {backgroundColor: 'var(--g-color-base-warning-heavy)'},
    '.cm-panels': {
        backgroundColor: 'var(--g-color-base-background)',
        color: 'var(--g-color-text-primary)',
    },
    '.cm-panels-bottom': {borderTop: '1px solid var(--g-color-line-generic)'},
    '.cm-panels-top': {borderBottom: '1px solid var(--g-color-line-generic)'},
    '.cm-textfield': {
        backgroundColor: 'var(--g-color-base-generic)',
        border: '1px solid var(--g-color-line-generic)',
        borderRadius: '4px',
        color: 'inherit',
    },
    '.cm-button': {
        backgroundImage: 'none',
        backgroundColor: 'var(--g-color-base-generic)',
        border: '1px solid var(--g-color-line-generic)',
        borderRadius: '4px',
        color: 'inherit',
    },
});

const SourceEditor = forwardRef<SourceHandle, SourceSurfaceProps>(function SourceEditor(
    {value, onChange, autoFocus},
    ref,
) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return undefined;
        // Settings › Check spelling is an attribute on the pane, which the textarea simply inherited.
        const spellcheck = host.closest('[spellcheck]')?.getAttribute('spellcheck') ?? 'false';
        const view = new EditorView({
            parent: host,
            state: EditorState.create({
                doc: value,
                extensions: [
                    history(),
                    drawSelection(),
                    EditorState.allowMultipleSelections.of(true),
                    EditorView.lineWrapping,
                    closeBrackets(),
                    bracketMatching(),
                    highlightSelectionMatches(),
                    search({top: true}),
                    markdown({base: markdownLanguage, codeLanguages: languages}),
                    syntaxHighlighting(markdownStyle),
                    wikiLinks,
                    theme,
                    EditorView.contentAttributes.of({
                        'aria-label': 'Markdown source',
                        spellcheck,
                    }),
                    keymap.of(
                        withoutAppChords([
                            ...closeBracketsKeymap,
                            ...markdownKeymap,
                            ...defaultKeymap,
                            ...searchKeymap,
                            ...historyKeymap,
                            indentWithTab,
                        ]),
                    ),
                    EditorView.updateListener.of((update) => {
                        if (update.docChanged) onChangeRef.current(update.state.doc.toString());
                    }),
                ],
            }),
        });
        viewRef.current = view;
        if (autoFocus || fallbackFocus.held) view.focus();
        fallbackFocus.held = false;
        return () => {
            view.destroy();
            viewRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `value` is read once, at mount
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
            const {main} = view.state.selection;
            return main.empty && main.head === 0 && view.state.doc.line(1).length === 0;
        },
    }));

    return <div ref={hostRef} className="block-editor-codemirror" />;
});

export default SourceEditor;
