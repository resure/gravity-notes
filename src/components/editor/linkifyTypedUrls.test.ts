import {type InputRule, inputRules} from 'prosemirror-inputrules';
import {type Mark, Schema} from 'prosemirror-model';
import {EditorState, TextSelection} from 'prosemirror-state';
import {describe, expect, it} from 'vitest';

import {linkifyTypedUrls} from './linkifyTypedUrls';

// A minimal schema with the marks the input rule inspects: `link` (what it creates — the attrs and
// `inclusive: false` mirror the editor's LinkSpecs, so the typed whitespace must land OUTSIDE the
// mark) plus `code` and `wiki_link` (which it must never fire inside). The real Gravity editor
// can't run in jsdom, so — like the wikiLinkExtension test — we drive the extension's input rule
// through a lightweight schema + the stock `inputRules` plugin.
const schema = new Schema({
    nodes: {
        doc: {content: 'block+'},
        paragraph: {group: 'block', content: 'inline*', toDOM: () => ['p', 0]},
        text: {group: 'inline'},
    },
    marks: {
        link: {
            attrs: {href: {}, 'raw-link': {default: false}},
            inclusive: false,
            toDOM: () => ['a'],
        },
        code: {code: true, toDOM: () => ['code', 0]}, // spec.code → inline code
        wiki_link: {toDOM: () => ['a', {class: 'wiki-link'}]},
    },
});

/**
 * Drive the real `linkifyTypedUrls` through a stub builder, capturing only the input-rules callback
 * (the bit under test), then return the constructed `InputRule[]` resolved against `schema`.
 */
function rulesFromExtension(): InputRule[] {
    let captured: InputRule[] = [];
    const builder = {
        addInputRules(factory: (deps: {schema: Schema}) => {rules: InputRule[]}) {
            captured = factory({schema}).rules;
            return builder;
        },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- structural stub of ExtensionBuilder
    linkifyTypedUrls(builder as any);
    return captured;
}

/**
 * Type `lastChar` at the caret with the extension's input rule active; returns the new state, or
 * null. `selection` overrides the default collapsed caret after the text — a from<to range drives
 * the rule the way prosemirror-view does when typing REPLACES a selection.
 */
function typeWithRule(
    textBefore: string,
    lastChar: string,
    marks: readonly Mark[] = [],
    selection?: {from: number; to: number},
): EditorState | null {
    const plugin = inputRules({rules: rulesFromExtension()});
    const para = schema.nodes.paragraph.create(null, schema.text(textBefore, [...marks]));
    const doc = schema.nodes.doc.create(null, para);
    let state = EditorState.create({schema, doc, plugins: [plugin]});
    const from = selection?.from ?? textBefore.length + 1; // default: after the existing text
    const to = selection?.to ?? from;
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
    let next: EditorState | null = null;
    const view = {
        state,
        composing: false,
        dispatch: (tr: typeof state.tr) => {
            next = state.apply(tr);
        },
    };
    const handler = plugin.props.handleTextInput as unknown as
        | ((view: unknown, from: number, to: number, text: string) => boolean)
        | undefined;
    handler?.(view, from, to, lastChar);
    return next;
}

/** The paragraph's text runs with their link-mark facts, for exact boundary assertions (null → []). */
function runsOf(state: EditorState | null): Array<{text: string; href?: string; raw?: boolean}> {
    const runs: Array<{text: string; href?: string; raw?: boolean}> = [];
    state?.doc.firstChild?.forEach((child) => {
        const link = child.marks.find((mark) => mark.type.name === 'link');
        runs.push({
            text: child.text ?? '',
            ...(link ? {href: link.attrs.href, raw: link.attrs['raw-link']} : {}),
        });
    });
    return runs;
}

describe('linkifyTypedUrls input rule', () => {
    it('marks exactly the typed URL on trailing space — boundary text and whitespace stay bare', () => {
        const result = typeWithRule('see https://example.com', ' ');
        // The `raw-link: true` attr is what makes the serializer emit the BARE url on disk.
        expect(runsOf(result)).toEqual([
            {text: 'see '},
            {text: 'https://example.com', href: 'https://example.com', raw: true},
            {text: ' '},
        ]);
    });

    it('fires at paragraph start too (the ^ boundary), for http as well as https', () => {
        const result = typeWithRule('http://example.com/a?b=c', ' ');
        expect(runsOf(result)).toEqual([
            {text: 'http://example.com/a?b=c', href: 'http://example.com/a?b=c', raw: true},
            {text: ' '},
        ]);
    });

    it('does NOT fire mid-word — foohttps://… stays plain', () => {
        expect(typeWithRule('foohttps://example.com', ' ')).toBeNull();
    });

    it('does NOT fire on bare domains — explicit scheme only, mirroring fuzzy-off parse', () => {
        // `.md` is a real TLD; a fuzzy match here would rewrite `Notes.md` mentions on disk.
        expect(typeWithRule('rename Notes.md', ' ')).toBeNull();
        expect(typeWithRule('example.com', ' ')).toBeNull();
    });

    it('does NOT fire on a non-whitespace character', () => {
        expect(typeWithRule('https://example.co', 'm')).toBeNull();
    });

    it('skips text that is already a link (no re-linking)', () => {
        const linked = schema.marks.link.create({href: 'https://example.com'});
        expect(typeWithRule('https://example.com', ' ', [linked])).toBeNull();
    });

    it('skips URLs inside a wiki link', () => {
        const wiki = schema.marks.wiki_link.create();
        expect(typeWithRule('https://example.com', ' ', [wiki])).toBeNull();
    });

    it('skips URLs inside inline code ({inCodeMark: false})', () => {
        const code = schema.marks.code.create();
        expect(typeWithRule('https://example.com', ' ', [code])).toBeNull();
    });

    it('does NOT fire when the typed whitespace replaces a selection (offsets would mis-mark)', () => {
        // "see https://example.com(bar)" with "(bar)" selected (doc positions 24–29): the rule's
        // offsets are caret-relative, and its transaction would supersede the selection-deleting
        // default — mis-marking the span and leaving "(bar)" undeleted. It must bail instead.
        expect(
            typeWithRule('see https://example.com(bar)', ' ', [], {from: 24, to: 29}),
        ).toBeNull();
    });

    it('keeps trailing sentence punctuation out of the link, like the parse-path linkify', () => {
        const result = typeWithRule('see https://example.com,', ' ');
        expect(runsOf(result)).toEqual([
            {text: 'see '},
            {text: 'https://example.com', href: 'https://example.com', raw: true},
            {text: ', '},
        ]);
    });

    it('trims an unbalanced closing paren but keeps a balanced one', () => {
        expect(runsOf(typeWithRule('(see https://example.com)', ' '))).toEqual([
            {text: '(see '},
            {text: 'https://example.com', href: 'https://example.com', raw: true},
            {text: ') '},
        ]);
        const wiki = 'https://en.wikipedia.org/wiki/Foo_(bar)';
        expect(runsOf(typeWithRule(wiki, ' '))).toEqual([
            {text: wiki, href: wiki, raw: true},
            {text: ' '},
        ]);
    });

    it('does NOT fire when trimming leaves a bare scheme', () => {
        expect(typeWithRule('https://...', ' ')).toBeNull();
    });
});
