import {widestRow} from './types';
import type {Block, TableData} from './types';

export const MAX_BLOCK_DEPTH = 6;

export function blockRangeIds(
    blocks: readonly Block[],
    anchorId: string,
    focusId: string,
): Set<string> {
    const anchor = blocks.findIndex((block) => block.id === anchorId);
    const focus = blocks.findIndex((block) => block.id === focusId);
    if (anchor < 0 || focus < 0) return new Set();
    const start = Math.min(anchor, focus);
    const end = Math.max(anchor, focus);
    return new Set(blocks.slice(start, end + 1).map((block) => block.id));
}

export function expandBlockIds(blocks: readonly Block[], ids: Iterable<string>): Set<string> {
    const expanded = new Set(ids);
    for (let index = 0; index < blocks.length; index++) {
        if (!expanded.has(blocks[index].id)) continue;
        const depth = blocks[index].depth ?? 0;
        let child = index + 1;
        while (child < blocks.length && (blocks[child].depth ?? 0) > depth) {
            expanded.add(blocks[child].id);
            child += 1;
        }
    }
    return expanded;
}

/**
 * Restore the depth invariant: the first block sits at 0, and no block is more than one level
 * deeper than the one before it.
 *
 * Structural operations move subtrees around VERBATIM — that is what keeps a drag from re-indenting
 * what it carries — so any of them can leave a block without the parent its depth implies. Markdown
 * has no way to write that: `blocksToMarkdown` indents from the depth alone, so the file comes back
 * one level flatter than the screen and the two disagree until the note is reopened. Running this
 * afterwards means the screen shows what the file will say.
 */
export function normalizeDepths(blocks: readonly Block[]): Block[] {
    // The ancestor chain of the block being emitted, as (depth as written → depth being written).
    // Renumbering off the chain rather than off the previous block alone is what keeps SIBLINGS
    // siblings: two list items orphaned by a delete both pop back to the same ancestor and both
    // land at the same depth, where promoting each relative to its predecessor would have nested
    // the second under the first.
    const ancestors: {raw: number; depth: number}[] = [];
    let changed = false;
    const output = blocks.map((block) => {
        const raw = block.depth ?? 0;
        while (ancestors.length > 0 && ancestors[ancestors.length - 1].raw >= raw) ancestors.pop();
        const depth = Math.min(
            MAX_BLOCK_DEPTH,
            ancestors.length === 0 ? 0 : ancestors[ancestors.length - 1].depth + 1,
        );
        ancestors.push({raw, depth});
        if (depth === raw) return block;
        changed = true;
        return {...block, depth};
    });
    return changed ? output : (blocks as Block[]);
}

export function duplicateBlockGroups(
    blocks: readonly Block[],
    ids: Iterable<string>,
    createId: () => string,
): {blocks: Block[]; copies: Block[]} {
    const expanded = expandBlockIds(blocks, ids);
    const output: Block[] = [];
    const copies: Block[] = [];

    for (let index = 0; index < blocks.length; ) {
        if (!expanded.has(blocks[index].id)) {
            output.push(blocks[index]);
            index += 1;
            continue;
        }
        const group: Block[] = [];
        while (index < blocks.length && expanded.has(blocks[index].id)) {
            group.push(blocks[index]);
            index += 1;
        }
        const groupCopies = group.map((block) => ({...block, id: createId()}));
        output.push(...group, ...groupCopies);
        copies.push(...groupCopies);
    }

    return {blocks: output, copies};
}

export function moveBlockSubtree(
    blocks: readonly Block[],
    sourceId: string,
    targetId: string,
    edge: 'before' | 'after',
): Block[] {
    if (sourceId === targetId) return blocks as Block[];
    const output = [...blocks];
    const sourceIndex = output.findIndex((block) => block.id === sourceId);
    if (sourceIndex < 0) return blocks as Block[];

    const sourceDepth = output[sourceIndex].depth ?? 0;
    let sourceEnd = sourceIndex + 1;
    while (sourceEnd < output.length && (output[sourceEnd].depth ?? 0) > sourceDepth)
        sourceEnd += 1;
    const moved = output.slice(sourceIndex, sourceEnd);
    if (moved.some((block) => block.id === targetId)) return blocks as Block[];
    output.splice(sourceIndex, moved.length);

    let targetIndex = output.findIndex((block) => block.id === targetId);
    if (targetIndex < 0) return blocks as Block[];
    if (edge === 'after') {
        const targetDepth = output[targetIndex].depth ?? 0;
        targetIndex += 1;
        while (targetIndex < output.length && (output[targetIndex].depth ?? 0) > targetDepth)
            targetIndex += 1;
    }
    output.splice(targetIndex, 0, ...moved);
    return output;
}

export function changeBlockDepth(
    blocks: readonly Block[],
    id: string,
    direction: -1 | 1,
    maxDepth = MAX_BLOCK_DEPTH,
): Block[] {
    const index = blocks.findIndex((block) => block.id === id);
    if (index < 0) return blocks as Block[];
    const currentDepth = blocks[index].depth ?? 0;
    let nextDepth = currentDepth - 1;
    if (direction > 0) {
        if (index === 0) return blocks as Block[];
        const previousDepth = blocks[index - 1].depth ?? 0;
        nextDepth = Math.min(maxDepth, currentDepth + 1, previousDepth + 1);
    }
    if (nextDepth < 0 || nextDepth === currentDepth) return blocks as Block[];

    let end = index + 1;
    while (end < blocks.length && (blocks[end].depth ?? 0) > currentDepth) end += 1;
    const delta = nextDepth - currentDepth;
    // Indenting is refused outright when a descendant is already at the limit: clamping it while
    // the parent still moved flattened the child into its sibling, losing a level of the user's
    // nesting with no sign that anything had been dropped.
    if (delta > 0) {
        for (let at = index; at < end; at++) {
            if ((blocks[at].depth ?? 0) + delta > maxDepth) return blocks as Block[];
        }
    }
    return blocks.map((block, blockIndex) =>
        blockIndex >= index && blockIndex < end
            ? {...block, depth: Math.max(0, Math.min(maxDepth, (block.depth ?? 0) + delta))}
            : block,
    );
}

export function setTableCell(
    table: TableData,
    row: number,
    column: number,
    html: string,
): TableData {
    if (!table.cells[row] || column < 0 || column >= table.cells[row].length) return table;
    return {
        ...table,
        cells: table.cells.map((cells, rowIndex) =>
            rowIndex === row
                ? cells.map((cell, columnIndex) => (columnIndex === column ? html : cell))
                : cells,
        ),
    };
}

export function addTableRowData(table: TableData): TableData {
    const columns = table.cells[0]?.length ?? 1;
    return {...table, cells: [...table.cells, Array(columns).fill('')]};
}

export function addTableColumnData(table: TableData): TableData {
    return {
        ...table,
        cells: table.cells.map((row) => [...row, '']),
        // Per-column metadata is positional, so it has to move with the columns — otherwise the
        // alignment and written width of every column past the edit slide onto its neighbour.
        align: table.align && [...table.align, null],
        widths: table.widths && [...table.widths, 0],
    };
}

export function deleteTableRowData(table: TableData, row: number): TableData {
    if (table.cells.length <= 1 || row < 0 || row >= table.cells.length) return table;
    return {...table, cells: table.cells.filter((_, index) => index !== row)};
}

export function deleteTableColumnData(table: TableData, column: number): TableData {
    const columns = table.cells[0]?.length ?? 0;
    if (columns <= 1 || column < 0 || column >= columns) return table;
    const without = <T>(list: T[] | undefined) => list?.filter((_, index) => index !== column);
    return {
        ...table,
        cells: table.cells.map((row) => row.filter((_, index) => index !== column)),
        align: without(table.align),
        widths: without(table.widths),
    };
}

export function pasteTableGrid(
    table: TableData,
    startRow: number,
    startColumn: number,
    matrix: readonly (readonly string[])[],
): TableData {
    if (!matrix.length || !matrix.some((row) => row.length)) return table;
    const targetRows = Math.max(table.cells.length, startRow + matrix.length);
    const widestPaste = widestRow(matrix);
    const targetColumns = Math.max(table.cells[0]?.length ?? 1, startColumn + widestPaste);
    const grow = <T>(list: T[] | undefined, fill: T) =>
        list && Array.from({length: targetColumns}, (_, index) => list[index] ?? fill);
    return {
        ...table,
        cells: Array.from({length: targetRows}, (_, rowIndex) =>
            Array.from({length: targetColumns}, (_, columnIndex) => {
                const pasted = matrix[rowIndex - startRow]?.[columnIndex - startColumn];
                return pasted === undefined ? (table.cells[rowIndex]?.[columnIndex] ?? '') : pasted;
            }),
        ),
        align: grow(table.align, null),
        widths: grow(table.widths, 0),
    };
}
