import {EditorState as CmState} from '@codemirror/state';
import {EditorView as CmView} from '@codemirror/view';
import {
    BaseSchema,
    Bold,
    Breaks,
    Clipboard,
    Code,
    CodeBlock,
    ExtensionsManager,
    Heading,
    Image,
    Italic,
    Lists,
    Logger2,
    Strike,
} from '@gravity-ui/markdown-editor';
// @ts-expect-error Runtime-only facet used by the pinned editor; its code-paste handler needs a logger.
import {LoggerFacet} from '@gravity-ui/markdown-editor/_/core/utils/logger.js';
import {LinkSpecs} from '@gravity-ui/markdown-editor/_/extensions/markdown/Link/LinkSpecs/index.js';
import {AllSelection, EditorState, TextSelection} from 'prosemirror-state';
import {EditorView} from 'prosemirror-view';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {
    createClipboardExtensions,
    insertUnformattedText,
    plainClipboardKey,
    unformattedText,
} from './clipboard';

const disposers: (() => void)[] = [];
// Layout is not under test; jsdom has no Range geometry for CodeMirror's animation-frame measure.
beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(0);
});
afterEach(() => {
    disposers.splice(0).forEach((dispose) => dispose());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function fixture(markdown = '') {
    const errors = vi.fn();
    const clipboard = createClipboardExtensions(errors);
    const deps = ExtensionsManager.process((builder) => {
        builder
            .use(BaseSchema, {})
            .use(Bold, {})
            .use(Italic, {})
            .use(Strike, {})
            .use(Code, {})
            .use(CodeBlock, {})
            .use(Heading, {})
            .use(LinkSpecs)
            .use(Lists, {})
            .use(Breaks, {})
            .use(Image, {})
            .use(Clipboard, {});
        clipboard.wysiwyg(builder);
    }, {});
    const root = document.createElement('div');
    document.body.append(root);
    const view = new EditorView(root, {
        state: EditorState.create({
            doc: deps.markupParser.parse(markdown),
            // Keep the real clipboard plugins; unrelated tooltip/keymap plugins need a full UI.
            plugins: [
                LoggerFacet.of(new Logger2()),
                ...deps.plugins.filter((plugin) => plugin.props.handleDOMEvents),
            ],
        }),
    });
    disposers.push(() => {
        view.destroy();
        root.remove();
    });
    return {...deps, view, errors, clipboard};
}

function clipboardEvent(
    type: 'copy' | 'cut' | 'paste',
    values: Record<string, string> = {},
    files: File[] = [],
) {
    const data = new Map(Object.entries(values));
    const event = new Event(type, {bubbles: true, cancelable: true});
    Object.defineProperty(event, 'clipboardData', {
        value: {
            getData: (key: string) => data.get(key) ?? '',
            setData: (key: string, value: string) => data.set(key, value),
            clearData: () => data.clear(),
            get types() {
                return [...data.keys()];
            },
            files,
        },
    });
    return {event, data};
}

describe('Markdown clipboard', () => {
    it.each([
        ['**bold** and *italic*', 'bold and italic'],
        ['[Label](https://example.com)', 'Label'],
        ['# Heading\n\nParagraph', 'Heading\n\nParagraph'],
        ['first\nsecond', 'first\nsecond'],
        ['![alt text](Attachments/test.png)', 'alt text'],
        ['`**literal**`', '**literal**'],
    ])('strips formatting from %j', (markdown, expected) => {
        const {markupParser} = fixture();
        expect(unformattedText(markupParser.parse(markdown))).toBe(expected);
    });

    it('copies Markdown to the public clipboard, with no HTML competing with it', () => {
        const {view} = fixture('**bold** and [link](https://example.com)');
        view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
        const {event, data} = clipboardEvent('copy');
        view.dom.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(data.get('text/plain')).toContain('**bold**');
        expect(data.get('text/plain')).toContain('[link](https://example.com)');
        expect(data.has('text/html')).toBe(false);
    });

    it('parses Markdown from an external plain-text clipboard', () => {
        const {view} = fixture();
        view.dom.dispatchEvent(clipboardEvent('paste', {'text/plain': '**bold**'}).event);
        expect(view.state.doc.textContent).toBe('bold');
        expect(view.state.doc.firstChild?.firstChild?.marks[0].type.name).toBe('strong');
    });

    it('preserves external rich-text formatting on ordinary paste', () => {
        const {view} = fixture();
        view.dom.dispatchEvent(
            clipboardEvent('paste', {
                'text/plain': 'Word bold',
                'text/html': '<p><strong>Word bold</strong></p>',
            }).event,
        );
        expect(view.state.doc.textContent).toBe('Word bold');
        expect(view.state.doc.firstChild?.firstChild?.marks[0].type.name).toBe('strong');
    });

    it('copies only a partial selection and keeps cut in Markdown too', () => {
        const {view} = fixture('before **bold** after');
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 8, 12)));
        const {event, data} = clipboardEvent('cut');
        view.dom.dispatchEvent(event);
        expect(data.get('text/plain')).toBe('**bold**');
        expect(view.state.doc.textContent).toBe('before  after');
    });

    it.each(['**bold**', 'bold'])('Shift-pastes %j without formatting in WYSIWYG', async (text) => {
        const {view} = fixture('replace');
        vi.stubGlobal('navigator', {clipboard: {readText: () => Promise.resolve(text)}});
        view.focus();
        view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
        view.dom.dispatchEvent(
            new KeyboardEvent('keydown', {
                code: 'KeyV',
                metaKey: true,
                shiftKey: true,
                bubbles: true,
                cancelable: true,
            }),
        );
        await vi.waitFor(() => expect(view.state.doc.textContent).toBe('bold'));
        expect(view.state.doc.firstChild?.firstChild?.marks).toEqual([]);
    });

    it('Shift-copies selected rendered text without changing the note', async () => {
        const {view} = fixture('**bold** and [label](https://example.com)');
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', {clipboard: {writeText}});
        view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
        const doc = view.state.doc;
        view.dom.dispatchEvent(
            new KeyboardEvent('keydown', {
                code: 'KeyC',
                ctrlKey: true,
                shiftKey: true,
                bubbles: true,
                cancelable: true,
            }),
        );
        expect(writeText).toHaveBeenCalledWith('bold and label');
        expect(view.state.doc).toBe(doc);
    });

    it('discards a pending plain paste when the editor is reset for another note', async () => {
        const {view, markupParser} = fixture('first note');
        let resolve!: (text: string) => void;
        vi.stubGlobal('navigator', {
            clipboard: {
                readText: () =>
                    new Promise<string>((done) => {
                        resolve = done;
                    }),
            },
        });
        view.focus();
        view.dom.dispatchEvent(
            new KeyboardEvent('keydown', {
                code: 'KeyV',
                metaKey: true,
                shiftKey: true,
                bubbles: true,
                cancelable: true,
            }),
        );
        view.updateState(
            EditorState.create({
                doc: markupParser.parse('second note'),
                plugins: view.state.plugins,
            }),
        );
        resolve('**wrong note**');
        await Promise.resolve();
        expect(view.state.doc.textContent).toBe('second note');
    });

    it('inserts unformatted text without inheriting surrounding bold', () => {
        const {view, schema} = fixture('**before after**');
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 8)));
        insertUnformattedText(view, 'plain');
        expect(view.state.doc.firstChild?.child(1).text).toBe('plain');
        expect(view.state.doc.firstChild?.child(1).marks).toEqual([]);
        expect(schema.marks.strong).toBeDefined();
    });

    it('preserves line breaks when inserting unformatted text', () => {
        const {view} = fixture();
        insertUnformattedText(view, 'first\nsecond\n\nthird');
        expect(unformattedText(view.state.doc)).toBe('first\nsecond\n\nthird');
    });

    it('keeps ordinary paste literal inside a code block', () => {
        const {view} = fixture('```\ncode\n```');
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 5)));
        view.dom.dispatchEvent(clipboardEvent('paste', {'text/plain': '**bold**'}).event);
        expect(view.state.doc.textContent).toBe('**bold**');
    });

    it('strips Markdown on Shift-paste in markup mode', async () => {
        const {clipboard} = fixture();
        const readText = vi.fn().mockResolvedValue('**bold** and [label](https://example.com)');
        vi.stubGlobal('navigator', {clipboard: {readText}});
        const root = document.createElement('div');
        document.body.append(root);
        const view = new CmView({
            parent: root,
            state: CmState.create({extensions: [clipboard.markup]}),
        });
        disposers.push(() => {
            view.destroy();
            root.remove();
        });
        view.focus();
        view.contentDOM.dispatchEvent(
            new KeyboardEvent('keydown', {
                code: 'KeyV',
                key: 'V',
                ctrlKey: true,
                shiftKey: true,
                bubbles: true,
                cancelable: true,
            }),
        );
        await vi.waitFor(() => expect(view.state.doc.toString()).toBe('bold and label'));
    });
});

describe('plain clipboard shortcuts', () => {
    it('does not insert after the note or selection changes during a read', async () => {
        let resolve!: (text: string) => void;
        vi.stubGlobal('navigator', {
            clipboard: {
                readText: () =>
                    new Promise<string>((done) => {
                        resolve = done;
                    }),
            },
        });
        const insertText = vi.fn();
        const isCurrent = vi.fn().mockReturnValue(true);
        plainClipboardKey(
            new KeyboardEvent('keydown', {code: 'KeyV', metaKey: true, shiftKey: true}),
            {selectedText: () => '', insertText, isCurrent},
            (text) => text,
            vi.fn(),
        );
        isCurrent.mockReturnValue(false);
        resolve('wrong note');
        await Promise.resolve();
        expect(insertText).not.toHaveBeenCalled();
    });

    it('reports clipboard permission failures without modifying the document', async () => {
        vi.stubGlobal('navigator', {
            clipboard: {readText: () => Promise.reject(new Error('denied'))},
        });
        const onError = vi.fn();
        const insertText = vi.fn();
        plainClipboardKey(
            new KeyboardEvent('keydown', {code: 'KeyV', ctrlKey: true, shiftKey: true}),
            {selectedText: () => '', insertText, isCurrent: () => true},
            (text) => text,
            onError,
        );
        await vi.waitFor(() => expect(onError).toHaveBeenCalled());
        expect(insertText).not.toHaveBeenCalled();
    });
});
