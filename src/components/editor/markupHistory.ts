import {type EditorState, Transaction, type TransactionSpec} from '@codemirror/state';

/**
 * Markup-mode (CodeMirror) undo isolation for the note-switch content swap.
 *
 * The Gravity editor keeps ONE CodeMirror instance for markup mode, created lazily on first use
 * and reused for the editor's whole life — and its `replace()` is a plain dispatched change, so
 * every note switch lands in the undo history: ⌘Z in markup mode could walk BACK INTO THE
 * PREVIOUS NOTE's content, which the change handler would then autosave into the current file
 * (silent cross-note corruption — the markup twin of the ProseMirror reset in EditorPane).
 *
 * There is no sanctioned "clear history" in CM6, and dispatching the swap with
 * `addToHistory: false` is NOT enough: old events are then *remapped* through the replacement,
 * and an insertion-type inverse (undo of a deletion) survives a whole-document mapping — ⌘Z
 * would still paste old-note fragments. The reliable reset is a fresh `EditorState`, which
 * needs the editor's full extension list — private to the bundle. So EditorPane snapshots the
 * CodeMirror state at creation time, while it is PRISTINE (empty history), and every switch
 * rebuilds the new note's state from that template: same extensions, new doc, no history.
 */

/**
 * The bundle editor's markup half, reachable at runtime but absent from the public
 * `MarkdownEditorInstance` type (`editor.markupEditor.cm` is the CodeMirror `EditorView`; the
 * getter lazily CREATES the markup editor on first access — EditorPane leans on that to obtain
 * the pristine template at mount). Kept to the members we touch.
 */
export interface MarkupEditorHandle {
    cm: {
        state: EditorState;
        setState(state: EditorState): void;
        dispatch(spec: TransactionSpec): void;
    };
}

/** Reach the markup (CodeMirror) half of the bundle editor; null when the shape ever changes. */
export function markupEditorOf(editor: unknown): MarkupEditorHandle | null {
    const markup = (editor as {markupEditor?: MarkupEditorHandle}).markupEditor;
    return markup && typeof markup.cm?.setState === 'function' ? markup : null;
}

/**
 * A state holding `content` with an EMPTY undo history, built on `template` (a pristine state
 * captured at CodeMirror-creation time, so it carries the editor's full extension set). The
 * replace is annotated `addToHistory: false` out of caution — the template's history is empty,
 * so there is nothing to remap either way — and the selection lands at the doc start (the swap
 * caller restores the per-note caret separately where it applies).
 */
export function freshMarkupState(template: EditorState, content: string): EditorState {
    return template.update({
        changes: {from: 0, to: template.doc.length, insert: content},
        selection: {anchor: 0},
        annotations: Transaction.addToHistory.of(false),
    }).state;
}
