import {describe, expect, it} from 'vitest';

import {
    addTableColumnData,
    addTableRowData,
    blockRangeIds,
    changeBlockDepth,
    deleteTableColumnData,
    deleteTableRowData,
    duplicateBlockGroups,
    expandBlockIds,
    moveBlockSubtree,
    pasteTableGrid,
    setTableCell,
} from './documentModel';
import type {Block, TableData} from './types';

const block = (id: string, depth = 0): Block => ({id, depth, type: 'text', html: id});
const ids = (blocks: readonly Block[]) => blocks.map((item) => item.id);

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

    it('keeps at least one row and one column', () => {
        const single: TableData = {cells: [['only']]};
        expect(deleteTableRowData(single, 0)).toBe(single);
        expect(deleteTableColumnData(single, 0)).toBe(single);
    });
});
