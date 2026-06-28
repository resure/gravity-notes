import {type InputRule, inputRules} from 'prosemirror-inputrules';
import {Schema} from 'prosemirror-model';
import {EditorState, TextSelection} from 'prosemirror-state';
import {describe, expect, it} from 'vitest';

import {WIKI_LINK_MARK, type WikiLinkOptions, wikiLinkExtension} from './wikiLinkExtension';

// A minimal schema with the two marks the input rule cares about — `wiki_link` (what it creates) and
// `code` (inline code, which it must NOT fire inside). The real Gravity editor can't run in jsdom, so
// we drive the extension's input rule through a lightweight schema + the stock `inputRules` plugin.
const schema = new Schema({
    nodes: {
        doc: {content: 'block+'},
        paragraph: {group: 'block', content: 'inline*', toDOM: () => ['p', 0]},
        text: {group: 'inline'},
    },
    marks: {
        code: {code: true, toDOM: () => ['code', 0]}, // spec.code → inline code
        [WIKI_LINK_MARK]: {toDOM: () => ['a', {class: 'wiki-link'}]},
    },
});

/**
 * Drive the real `wikiLinkExtension` through a stub builder, capturing only the input-rules callback
 * (the bit under test), then return the constructed `InputRule[]` resolved against `schema`.
 */
function inputRulesFromExtension(): InputRule[] {
    let captured: InputRule[] = [];
    const builder = {
        Priority: {VeryHigh: 0, High: 1, Medium: 2, Low: 3, VeryLow: 4},
        configureMd() {
            return builder;
        },
        addMark() {
            return builder;
        },
        addPlugin() {
            return builder;
        },
        addInputRules(cb: (deps: {schema: Schema}) => {rules: InputRule[]}) {
            captured = cb({schema}).rules;
            return builder;
        },
    };
    const opts: WikiLinkOptions = {
        getNotes: () => [],
        getCurrentId: () => '',
        onOpen: () => {},
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- structural stub of ExtensionBuilder
    wikiLinkExtension(builder as any, opts);
    return captured;
}

/** Type `lastChar` at the caret with the extension's input rule active; returns the new doc, or null. */
function typeWithRule(textBefore: string, lastChar: string, inCode: boolean) {
    const plugin = inputRules({rules: inputRulesFromExtension()});
    const marks = inCode ? [schema.marks.code.create()] : [];
    const para = schema.nodes.paragraph.create(null, schema.text(textBefore, marks));
    const doc = schema.nodes.doc.create(null, para);
    let state = EditorState.create({schema, doc, plugins: [plugin]});
    const caret = textBefore.length + 1; // inside the paragraph, after the existing text
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, caret)));
    let next: typeof state | null = null;
    const view = {
        state,
        composing: false,
        dispatch: (tr: ReturnType<typeof state.tr.insertText>) => {
            next = state.apply(tr);
        },
    };
    const handler = plugin.props.handleTextInput as unknown as
        | ((view: unknown, from: number, to: number, text: string) => boolean)
        | undefined;
    handler?.(view, caret, caret, lastChar);
    return next;
}

describe('wikiLinkExtension input rule', () => {
    const wikiType = schema.marks[WIKI_LINK_MARK];
    const hasWiki = (state: EditorState) =>
        state.doc.rangeHasMark(0, state.doc.content.size, wikiType);

    it('turns [[x]] into a wiki link in plain text', () => {
        const result = typeWithRule('[[x]', ']', false);
        expect(result).not.toBeNull();
        expect(hasWiki(result!)).toBe(true);
    });

    it('does NOT create a wiki link when typed inside an inline-code span', () => {
        // Regression: prosemirror-inputrules defaults inCodeMark to true, so without {inCodeMark:
        // false} the rule would fire inside `code` — diverging from the suggest plugin + load path.
        const result = typeWithRule('[[x]', ']', true);
        expect(result).toBeNull(); // rule skipped entirely → no transaction dispatched
    });
});
