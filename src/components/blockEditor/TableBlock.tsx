import {useLayoutEffect, useRef, useState} from 'react';
import type {ClipboardEvent, KeyboardEvent} from 'react';

import type {Block} from './types';

export function tableCellId(blockId: string, row: number, column: number): string {
    return `${blockId}:cell:${row}:${column}`;
}

interface TableBlockProps {
    block: Block;
    onCellRef: (id: string, element: HTMLDivElement | null) => void;
    onCellInput: (blockId: string, row: number, column: number, html: string) => void;
    onCellKeyDown: (
        event: KeyboardEvent<HTMLDivElement>,
        blockId: string,
        row: number,
        column: number,
    ) => void;
    onCellPaste: (
        event: ClipboardEvent<HTMLDivElement>,
        blockId: string,
        row: number,
        column: number,
    ) => void;
    onCellFocus: (cellId: string) => void;
    onAddRow: (blockId: string) => void;
    onAddColumn: (blockId: string) => void;
    onDeleteRow: (blockId: string, row: number) => void;
    onDeleteColumn: (blockId: string, column: number) => void;
    onToggleHeaderRow: (blockId: string) => void;
    onToggleHeaderColumn: (blockId: string) => void;
}

interface TableCellProps {
    blockId: string;
    row: number;
    column: number;
    html: string;
    header: boolean;
    props: TableBlockProps;
    onFocusCell: () => void;
}

function TableCell({blockId, row, column, html, header, props, onFocusCell}: TableCellProps) {
    // Written by the ref callback below, so it is a mutable holder rather than a React-owned ref
    // (React 18's `useRef<T>(null)` types `.current` read-only).
    const ref = useRef<HTMLDivElement | null>(null);
    const id = tableCellId(blockId, row, column);

    useLayoutEffect(() => {
        const element = ref.current;
        if (!element || element.innerHTML === html) return;
        element.innerHTML = html;
    }, [html]);

    return (
        <td className={header ? 'table-header-cell' : undefined}>
            <div
                ref={(element) => {
                    ref.current = element;
                    props.onCellRef(id, element);
                }}
                className="table-cell-content"
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-label={`Table row ${row + 1}, column ${column + 1}`}
                aria-multiline="true"
                spellCheck
                data-block-id={id}
                data-block-type="text"
                data-table-block-id={blockId}
                data-table-row={row}
                data-table-column={column}
                onInput={(event) =>
                    props.onCellInput(blockId, row, column, event.currentTarget.innerHTML)
                }
                onKeyDown={(event) => props.onCellKeyDown(event, blockId, row, column)}
                onPaste={(event) => props.onCellPaste(event, blockId, row, column)}
                onFocus={() => {
                    onFocusCell();
                    props.onCellFocus(id);
                }}
            />
        </td>
    );
}

export default function TableBlock(props: TableBlockProps) {
    const {block} = props;
    const table = block.table;
    const [focusedCell, setFocusedCell] = useState({row: 0, column: 0});
    if (!table) return null;

    const rows = table.cells.length;
    const columns = Math.max(1, ...table.cells.map((row) => row.length));
    const preventBlur = (event: React.MouseEvent) => event.preventDefault();

    return (
        <div className="table-block-shell">
            <div
                className="table-toolbar"
                contentEditable={false}
                role="toolbar"
                aria-label="Table options"
            >
                <button
                    type="button"
                    className={table.headerRow ? 'active' : ''}
                    aria-pressed={Boolean(table.headerRow)}
                    onMouseDown={preventBlur}
                    onClick={() => props.onToggleHeaderRow(block.id)}
                >
                    Header row
                </button>
                <button
                    type="button"
                    className={table.headerColumn ? 'active' : ''}
                    aria-pressed={Boolean(table.headerColumn)}
                    onMouseDown={preventBlur}
                    onClick={() => props.onToggleHeaderColumn(block.id)}
                >
                    Header column
                </button>
                <span className="table-toolbar-divider" />
                <button
                    type="button"
                    disabled={rows <= 1}
                    onMouseDown={preventBlur}
                    onClick={() => props.onDeleteRow(block.id, focusedCell.row)}
                >
                    Delete row
                </button>
                <button
                    type="button"
                    disabled={columns <= 1}
                    onMouseDown={preventBlur}
                    onClick={() => props.onDeleteColumn(block.id, focusedCell.column)}
                >
                    Delete column
                </button>
            </div>

            <div className="table-scroll">
                <table className="simple-table">
                    <tbody>
                        {table.cells.map((cells, row) => (
                            <tr key={row}>
                                {Array.from({length: columns}, (_, column) => (
                                    <TableCell
                                        key={column}
                                        blockId={block.id}
                                        row={row}
                                        column={column}
                                        html={cells[column] ?? ''}
                                        header={
                                            (Boolean(table.headerRow) && row === 0) ||
                                            (Boolean(table.headerColumn) && column === 0)
                                        }
                                        props={props}
                                        onFocusCell={() => setFocusedCell({row, column})}
                                    />
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <button
                type="button"
                className="table-add table-add-column"
                aria-label="Add column"
                title="Add column"
                onMouseDown={preventBlur}
                onClick={() => props.onAddColumn(block.id)}
            >
                +
            </button>
            <button
                type="button"
                className="table-add table-add-row"
                aria-label="Add row"
                title="Add row"
                onMouseDown={preventBlur}
                onClick={() => props.onAddRow(block.id)}
            >
                +
            </button>
        </div>
    );
}
