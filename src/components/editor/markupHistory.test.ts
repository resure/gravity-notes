import {history, redoDepth, undoDepth} from '@codemirror/commands';
import {EditorState} from '@codemirror/state';
import {describe, expect, it} from 'vitest';

import {freshMarkupState, markupEditorOf} from './markupHistory';

/** A minimal state with undo history enabled — the aspect of the real markup config under test. */
function stateWith(doc: string): EditorState {
    return EditorState.create({doc, extensions: [history()]});
}

/** Apply a user-style edit (recorded in history). */
function type(state: EditorState, at: number, insert: string): EditorState {
    return state.update({changes: {from: at, insert}, userEvent: 'input.type'}).state;
}

describe('freshMarkupState', () => {
    it('starts the new note with an empty undo/redo history', () => {
        const template = stateWith('first note');
        const fresh = freshMarkupState(template, 'second note');
        expect(fresh.doc.toString()).toBe('second note');
        expect(undoDepth(fresh)).toBe(0);
        expect(redoDepth(fresh)).toBe(0);
        // Caret parked at the start, matching the ProseMirror reset's doc-start selection.
        expect(fresh.selection.main.anchor).toBe(0);
    });

    it('contrast: a plain replace keeps the previous note reachable via undo (the bug)', () => {
        // The reused CodeMirror instance after edits in note A…
        let state = stateWith('note A');
        state = type(state, 6, ' plus edits');
        // …then a note switch done as a plain replace (what editor.replace() dispatches).
        state = state.update({
            changes: {from: 0, to: state.doc.length, insert: 'note B'},
        }).state;
        // Undo history still reaches back across the switch — this is exactly what the fresh
        // template state prevents.
        expect(undoDepth(state)).toBeGreaterThan(0);
    });

    it('drops history accumulated before the swap even for a same-length doc', () => {
        let template = stateWith('abc');
        // The template must be captured PRISTINE; but even if edits happened on some other state
        // derived from it, building from the pristine template ignores them.
        const edited = type(template, 3, 'def');
        expect(undoDepth(edited)).toBe(1);
        template = stateWith('abc'); // pristine capture
        const fresh = freshMarkupState(template, 'xyz');
        expect(undoDepth(fresh)).toBe(0);
        expect(fresh.doc.toString()).toBe('xyz');
    });
});

describe('markupEditorOf', () => {
    it('reaches a bundle-editor-shaped object and rejects anything else', () => {
        const cm = {state: stateWith(''), setState: () => {}};
        expect(markupEditorOf({markupEditor: {cm}})).toEqual({cm});
        expect(markupEditorOf({})).toBeNull();
        expect(markupEditorOf({markupEditor: {}})).toBeNull();
        expect(markupEditorOf({markupEditor: {cm: {}}})).toBeNull();
    });
});
