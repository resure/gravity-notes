import {describe, expect, it, vi} from 'vitest';

import {type BodyEditor, atEmptyFirstLine, openLineAbove, removeEmptyFirstLine} from './editorBody';

const EMPTY_PARA = {type: {name: 'paragraph'}, nodeSize: 2, content: {size: 0}};
const TEXT_PARA = {type: {name: 'paragraph'}, nodeSize: 7, content: {size: 5}};

interface Op {
    op: 'insert' | 'delete';
    [k: string]: unknown;
}

function makeEditor(opts: {
    firstChild?: {type: {name: string}; nodeSize: number; content: {size: number}} | null;
    childCount?: number;
    selection?: {empty: boolean; from: number};
    hasView?: boolean;
}) {
    const ops: Op[] = [];
    const dispatched: unknown[] = [];
    const moveCursor = vi.fn();
    const focus = vi.fn();
    const createdPara = {...EMPTY_PARA};
    const tr = {
        insert(pos: number, node: unknown) {
            ops.push({op: 'insert', pos, node});
            return tr;
        },
        delete(from: number, to: number) {
            ops.push({op: 'delete', from, to});
            return tr;
        },
    };
    const view =
        opts.hasView === false
            ? null
            : {
                  state: {
                      doc: {
                          firstChild: opts.firstChild ?? EMPTY_PARA,
                          childCount: opts.childCount ?? 1,
                      },
                      selection: opts.selection ?? {empty: true, from: 1},
                      schema: {nodes: {paragraph: {createAndFill: () => createdPara}}},
                      tr,
                  },
                  dispatch: (t: unknown) => dispatched.push(t),
              };
    const editor: BodyEditor = {_wysiwygView: view, moveCursor, focus};
    return {editor, ops, dispatched, moveCursor, focus};
}

describe('editorBody', () => {
    describe('openLineAbove', () => {
        it('inserts an empty paragraph at the top when the first block has content', () => {
            const {editor, ops, moveCursor, focus} = makeEditor({firstChild: TEXT_PARA});
            expect(openLineAbove(editor)).toBe(true);
            expect(ops).toEqual([{op: 'insert', pos: 0, node: EMPTY_PARA}]);
            expect(moveCursor).toHaveBeenCalledWith('start');
            expect(focus).toHaveBeenCalled();
        });

        it('does not stack a blank when the first block is already empty', () => {
            const {editor, ops, moveCursor} = makeEditor({firstChild: EMPTY_PARA});
            expect(openLineAbove(editor)).toBe(true);
            expect(ops).toEqual([]); // no insert
            expect(moveCursor).toHaveBeenCalledWith('start');
        });

        it('returns false and does nothing in markup mode (no view)', () => {
            const {editor, moveCursor} = makeEditor({hasView: false});
            expect(openLineAbove(editor)).toBe(false);
            expect(moveCursor).not.toHaveBeenCalled();
        });
    });

    describe('atEmptyFirstLine', () => {
        it('is true at the start of an empty first paragraph', () => {
            const {editor} = makeEditor({
                firstChild: EMPTY_PARA,
                selection: {empty: true, from: 1},
            });
            expect(atEmptyFirstLine(editor)).toBe(true);
        });

        it('is false when the first paragraph has content', () => {
            const {editor} = makeEditor({firstChild: TEXT_PARA, selection: {empty: true, from: 1}});
            expect(atEmptyFirstLine(editor)).toBe(false);
        });

        it('is false when the caret is not at the start', () => {
            const {editor} = makeEditor({
                firstChild: EMPTY_PARA,
                selection: {empty: true, from: 4},
            });
            expect(atEmptyFirstLine(editor)).toBe(false);
        });

        it('is false with no view', () => {
            const {editor} = makeEditor({hasView: false});
            expect(atEmptyFirstLine(editor)).toBe(false);
        });
    });

    describe('removeEmptyFirstLine', () => {
        it('deletes the empty first paragraph when more content follows', () => {
            const {editor, ops} = makeEditor({firstChild: EMPTY_PARA, childCount: 2});
            removeEmptyFirstLine(editor);
            expect(ops).toEqual([{op: 'delete', from: 0, to: 2}]);
        });

        it('leaves the doc alone when the empty paragraph is the only block', () => {
            const {editor, ops} = makeEditor({firstChild: EMPTY_PARA, childCount: 1});
            removeEmptyFirstLine(editor);
            expect(ops).toEqual([]);
        });
    });
});
