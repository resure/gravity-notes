import {describe, expect, it} from 'vitest';

import {
    MAX_BLOCK_DEPTH,
    addTableColumnData,
    addTableRowData,
    blockRangeIds,
    changeBlockDepth,
    deleteTableColumnData,
    deleteTableRowData,
    duplicateBlockGroups,
    expandBlockIds,
    moveBlockSubtree,
    moveBlockSubtrees,
    normalizeDepths,
    pasteTableGrid,
    selectionRoots,
    setTableCell,
} from './documentModel';
import type {Block, TableData} from './types';

const block = (id: string, depth = 0): Block => ({id, depth, type: 'text', html: id});
const ids = (blocks: readonly Block[]) => blocks.map((item) => item.id);

describe('changeBlockDepth at the depth limit', () => {
    it('refuses an indent that would flatten a child into its parent', () => {
        // Clamping the child while the parent still moved lost a level of the user's nesting, with
        // nothing on screen to say a level had been dropped.
        const deep = [block('sib', 5), block('parent', 5), block('child', 6)];
        expect(changeBlockDepth(deep, 'parent', 1)).toBe(deep);
    });
});

describe('normalizeDepths', () => {
    it('pulls a block back to a depth its parent can support', () => {
        // What a drop leaves behind: `c` carried its own depth to the top of the document, where
        // there is nothing for it to be nested under. Markdown cannot write that, so the file came
        // back a level flatter than the screen showed.
        const out = normalizeDepths([block('c', 2), block('a'), block('b', 1)]);
        expect(out.map((item) => item.depth)).toEqual([0, 0, 1]);
    });

    it('leaves a legal document alone, identity included', () => {
        const legal = [block('a'), block('a1', 1), block('a2', 1), block('b')];
        expect(normalizeDepths(legal)).toBe(legal);
    });

    it('closes a gap left by a removed parent without flattening the rest', () => {
        const out = normalizeDepths([block('a'), block('b1', 2), block('b2', 3), block('c')]);
        expect(out.map((item) => item.depth)).toEqual([0, 1, 2, 0]);
    });

    /**
     * The whole point of the function, asserted over the shapes a delete, drop or paste can leave —
     * an earlier one-shift-per-run version satisfied every example above and still left 16% of
     * random documents illegal, which is exactly the screen/file disagreement it exists to remove.
     */
    it('always leaves a legal document, whatever it is given', () => {
        let seed = 12345;
        const next = (n: number) => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed % n;
        };
        for (let run = 0; run < 20000; run++) {
            const input = Array.from({length: 1 + next(8)}, (_, index) =>
                block(`b${index}`, next(MAX_BLOCK_DEPTH + 2)),
            );
            const out = normalizeDepths(input);
            expect(out).toHaveLength(input.length);
            expect(out.map((item) => item.id)).toEqual(input.map((item) => item.id));
            let previous = -1;
            for (const item of out) {
                const depth = item.depth ?? 0;
                expect(depth).toBeGreaterThanOrEqual(0);
                expect(depth).toBeLessThanOrEqual(Math.min(MAX_BLOCK_DEPTH, previous + 1));
                previous = depth;
            }
        }
    });

    it('promotes orphaned siblings together, not one under the other', () => {
        // What a delete leaves: two list items whose parent is gone. Promoting each on its own
        // makes the second a CHILD of the first, which is not what was on screen.
        const out = normalizeDepths([block('childA', 1), block('childB', 1)]);
        expect(out.map((item) => item.depth)).toEqual([0, 0]);
    });
});

describe('nested block operations', () => {
    const nested = [
        block('a'),
        block('a1', 1),
        block('a2', 1),
        block('b'),
        block('b1', 1),
        block('c'),
    ];

    it('expands selected parents to contiguous descendants', () => {
        expect([...expandBlockIds(nested, ['a'])]).toEqual(['a', 'a1', 'a2']);
    });

    it('keeps only the roots of a selection', () => {
        // A child that came along inside a selected parent must not be acted on twice: an indent
        // already carries it.
        expect(selectionRoots(nested, new Set(['a', 'a1', 'b1']))).toEqual(['a', 'b1']);
    });

    it('builds inclusive ranges in either direction', () => {
        expect([...blockRangeIds(nested, 'a1', 'b')]).toEqual(['a1', 'a2', 'b']);
        expect([...blockRangeIds(nested, 'b', 'a1')]).toEqual(['a1', 'a2', 'b']);
    });

    it('duplicates a subtree as one contiguous group', () => {
        let sequence = 0;
        const result = duplicateBlockGroups(nested, ['a'], () => `copy${++sequence}`);
        expect(ids(result.blocks)).toEqual([
            'a',
            'a1',
            'a2',
            'copy1',
            'copy2',
            'copy3',
            'b',
            'b1',
            'c',
        ]);
        expect(result.copies.map((item) => item.depth)).toEqual([0, 1, 1]);
    });

    it('moves a parent and descendants after the target subtree', () => {
        expect(ids(moveBlockSubtree(nested, 'a', 'b', 'after'))).toEqual([
            'b',
            'b1',
            'a',
            'a1',
            'a2',
            'c',
        ]);
    });

    it('does not move a parent into its own subtree', () => {
        expect(moveBlockSubtree(nested, 'a', 'a1', 'after')).toBe(nested);
    });

    it('lands a dropped block at the target’s level rather than adopting its neighbours', () => {
        // `c` dropped between `a` and its children used to keep depth 0 and make a1/a2 its own
        // children. The block the reader aimed at keeps its parent; the dragged one takes its level.
        const out = moveBlockSubtree(nested, 'c', 'a1', 'before');
        expect(out.map((item) => [item.id, item.depth])).toEqual([
            ['a', 0],
            ['c', 1],
            ['a1', 1],
            ['a2', 1],
            ['b', 0],
            ['b1', 1],
        ]);
    });

    it('re-levels a whole subtree by one delta, keeping its own shape', () => {
        const out = moveBlockSubtree(nested, 'a', 'b1', 'after');
        expect(out.map((item) => [item.id, item.depth])).toEqual([
            ['b', 0],
            ['b1', 1],
            ['a', 1],
            ['a1', 2],
            ['a2', 2],
            ['c', 0],
        ]);
    });

    it('moves a whole selection as one run, in document order', () => {
        // What a drag from inside a block selection does: `a` (with its children) and `c` travel
        // together and land as one group, however far apart they started.
        const out = moveBlockSubtrees(nested, ['c', 'a'], 'b', 'before');
        expect(out.map((item) => [item.id, item.depth])).toEqual([
            ['a', 0],
            ['a1', 1],
            ['a2', 1],
            ['c', 0],
            ['b', 0],
            ['b1', 1],
        ]);
    });

    it('refuses a selection dropped into its own subtree', () => {
        expect(moveBlockSubtrees(nested, ['a', 'c'], 'a1', 'after')).toBe(nested);
    });

    it('carries a selection to the target’s level without flattening it', () => {
        const out = moveBlockSubtrees(nested, ['a', 'c'], 'b1', 'after');
        expect(out.map((item) => [item.id, item.depth])).toEqual([
            ['b', 0],
            ['b1', 1],
            ['a', 1],
            ['a1', 2],
            ['a2', 2],
            ['c', 1],
        ]);
    });

    it('stops re-levelling where the deepest carried block would pass the limit', () => {
        const ladder = [0, 1, 2, 3, 4].map((depth) => block(`p${depth}`, depth));
        const deep = [
            ...ladder,
            block('target', 5),
            block('src', 0),
            block('child', 1),
            block('grandchild', 2),
        ];
        const out = moveBlockSubtree(deep, 'src', 'target', 'after');
        expect(out.slice(-3).map((item) => [item.id, item.depth])).toEqual([
            ['src', 4],
            ['child', 5],
            ['grandchild', 6],
        ]);
    });

    it('indents and outdents a block with all descendants', () => {
        const indented = changeBlockDepth(nested, 'b', 1);
        expect(indented.find((item) => item.id === 'b')?.depth).toBe(1);
        expect(indented.find((item) => item.id === 'b1')?.depth).toBe(2);
        const restored = changeBlockDepth(indented, 'b', -1);
        expect(restored.find((item) => item.id === 'b')?.depth).toBe(0);
        expect(restored.find((item) => item.id === 'b1')?.depth).toBe(1);
    });
});

describe('table matrix operations', () => {
    const table = (): TableData => ({
        cells: [
            ['a', 'b'],
            ['c', 'd'],
        ],
    });

    it('updates a cell without mutating the source', () => {
        const source = table();
        const next = setTableCell(source, 1, 0, '<strong>x</strong>');
        expect(next.cells[1][0]).toBe('<strong>x</strong>');
        expect(source.cells[1][0]).toBe('c');
    });

    it('adds and removes rectangular rows and columns', () => {
        const withRow = addTableRowData(table());
        expect(withRow.cells).toEqual([
            ['a', 'b'],
            ['c', 'd'],
            ['', ''],
        ]);
        const withColumn = addTableColumnData(withRow);
        expect(withColumn.cells.every((row) => row.length === 3)).toBe(true);
        expect(deleteTableRowData(withColumn, 1).cells).toHaveLength(2);
        expect(deleteTableColumnData(withColumn, 1).cells.every((row) => row.length === 2)).toBe(
            true,
        );
    });

    it('expands a table for spreadsheet paste while preserving untouched cells', () => {
        const next = pasteTableGrid(table(), 1, 1, [
            ['x', 'y'],
            ['z', 'w'],
        ]);
        expect(next.cells).toEqual([
            ['a', 'b', ''],
            ['c', 'x', 'y'],
            ['', 'z', 'w'],
        ]);
    });

    it('moves per-column metadata with the columns', () => {
        // `align` and `widths` are POSITIONAL. Leaving them alone slid every column's alignment and
        // written width onto its neighbour — a silent mis-assignment in the user's file, and the
        // reason the fields have to be re-keyed here and not just preserved.
        const aligned: TableData = {
            cells: [
                ['a', 'b', 'c'],
                ['1', '2', '3'],
            ],
            align: [null, null, 'right'],
            widths: [5, 6, 7],
        };
        expect(deleteTableColumnData(aligned, 0)).toMatchObject({
            align: [null, 'right'],
            widths: [6, 7],
        });
        expect(addTableColumnData(aligned)).toMatchObject({
            align: [null, null, 'right', null],
            widths: [5, 6, 7, 0],
        });
        expect(pasteTableGrid(aligned, 0, 2, [['x', 'y']])).toMatchObject({
            align: [null, null, 'right', null],
            widths: [5, 6, 7, 0],
        });
    });

    it('keeps at least one row and one column', () => {
        const single: TableData = {cells: [['only']]};
        expect(deleteTableRowData(single, 0)).toBe(single);
        expect(deleteTableColumnData(single, 0)).toBe(single);
    });
});
