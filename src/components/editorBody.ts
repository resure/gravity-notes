/**
 * Body-document helpers for the title↔body handoff, operating on the WYSIWYG editor's
 * ProseMirror view (reached through the editor instance's internal `_wysiwygView` getter).
 *
 * "An empty line at the top of the note" is an empty paragraph node — not representable in
 * Markdown markup — so these go through the view rather than the editor's markup `insert`.
 * Everything is feature-detected and wrapped: in Markup mode (no `_wysiwygView`) or on any
 * error the functions no-op / report `false`, and the caller falls back to plain navigation.
 * The real editor can't run in jsdom, so this is unit-tested against a fake view (its logic)
 * and verified for real in the browser.
 */

/** The thin slice of the ProseMirror API we touch, typed locally to avoid a prosemirror dep. */
interface PmNode {
    readonly type: {readonly name: string};
    readonly nodeSize: number;
    readonly content: {readonly size: number};
}
interface PmTransaction {
    insert(pos: number, node: PmNode): PmTransaction;
    delete(from: number, to: number): PmTransaction;
}
interface PmState {
    readonly doc: {readonly firstChild: PmNode | null; readonly childCount: number};
    readonly selection: {readonly empty: boolean; readonly from: number};
    readonly schema: {readonly nodes: Record<string, {createAndFill(): PmNode | null} | undefined>};
    readonly tr: PmTransaction;
}
interface PmView {
    readonly state: PmState;
    dispatch(tr: PmTransaction): void;
}

/** What we need from the editor instance: the (untyped) view getter plus cursor/focus. */
export interface BodyEditor {
    readonly _wysiwygView?: PmView | null;
    moveCursor(position: 'start' | 'end'): void;
    focus(): void;
}

function getView(editor: BodyEditor): PmView | null {
    const view = editor._wysiwygView;
    return view && view.state && typeof view.dispatch === 'function' ? view : null;
}

function isEmptyParagraph(node: PmNode | null): boolean {
    return node !== null && node.type.name === 'paragraph' && node.content.size === 0;
}

/**
 * Open an empty line at the very top of the body and place the caret on it. Skips inserting
 * when the first block is already an empty paragraph (so it doesn't stack blanks). Returns
 * `false` when it couldn't act (Markup mode / no view), so the caller can fall back.
 */
export function openLineAbove(editor: BodyEditor): boolean {
    const view = getView(editor);
    if (!view) return false;
    try {
        const {state} = view;
        if (!isEmptyParagraph(state.doc.firstChild)) {
            const paragraph = state.schema.nodes.paragraph?.createAndFill();
            if (!paragraph) return false;
            view.dispatch(state.tr.insert(0, paragraph));
        }
        editor.moveCursor('start'); // caret into the (now) empty first paragraph
        editor.focus();
        return true;
    } catch {
        return false;
    }
}

/** True when the caret is collapsed at the start of an empty first paragraph in the body. */
export function atEmptyFirstLine(editor: BodyEditor): boolean {
    const view = getView(editor);
    if (!view) return false;
    try {
        const {selection, doc} = view.state;
        return selection.empty && selection.from <= 1 && isEmptyParagraph(doc.firstChild);
    } catch {
        return false;
    }
}

/**
 * Remove the empty first paragraph (the one `openLineAbove` added), but never leave the doc
 * empty — if it's the only block, leave it in place. The caller moves focus to the title.
 */
export function removeEmptyFirstLine(editor: BodyEditor): void {
    const view = getView(editor);
    if (!view) return;
    try {
        const {doc} = view.state;
        const first = doc.firstChild;
        // Self-protecting: only remove the block when it's actually the empty paragraph this helper
        // owns (and isn't the doc's last block), so a non-empty/changed first block is never deleted.
        if (first && isEmptyParagraph(first) && doc.childCount > 1) {
            view.dispatch(view.state.tr.delete(0, first.nodeSize));
        }
    } catch {
        // Ignore — the caller still hands focus back to the title.
    }
}
