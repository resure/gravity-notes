export type BlockType =
    | 'text'
    | 'heading1'
    | 'heading2'
    | 'heading3'
    | 'todo'
    | 'bulleted'
    | 'numbered'
    | 'toggle'
    | 'table'
    | 'quote'
    | 'callout'
    | 'divider'
    | 'code'
    | 'image';

export type BlockColor =
    | 'default'
    | 'gray'
    | 'brown'
    | 'orange'
    | 'yellow'
    | 'green'
    | 'blue'
    | 'purple'
    | 'pink'
    | 'red'
    | 'gray_background'
    | 'brown_background'
    | 'orange_background'
    | 'yellow_background'
    | 'green_background'
    | 'blue_background'
    | 'purple_background'
    | 'pink_background'
    | 'red_background';

export interface Block {
    id: string;
    type: BlockType;
    html: string;
    checked?: boolean;
    /** Visual nesting level. A flat model keeps serialization and reordering simple. */
    depth?: number;
    /** Toggle blocks hide the contiguous, more deeply nested blocks below them. */
    collapsed?: boolean;
    /** Structured data for simple table blocks. Cell values use the inline HTML format. */
    table?: TableData;
    /** Notion-style block text or background color token. */
    color?: BlockColor;
    /** Media for image blocks: a root-relative `Attachments/…` ref plus its alt text. */
    image?: ImageData;
}

export interface ImageData {
    /** Root-relative attachment reference (`Attachments/photo.png`), or an absolute URL. */
    src: string;
    alt?: string;
    /** Rendered width in pixels; unset means the natural/default width. */
    width?: number;
}

export interface TableData {
    cells: string[][];
    headerRow?: boolean;
    headerColumn?: boolean;
}

let counter = 0;

export function uid(): string {
    counter += 1;
    return `b${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newBlock(type: BlockType = 'text', html = ''): Block {
    return {
        id: uid(),
        type,
        html,
        depth: 0,
        table: type === 'table' ? newTableData(html) : undefined,
    };
}

export function newTableData(firstCell = ''): TableData {
    return {
        cells: [
            [firstCell, '', ''],
            ['', '', ''],
        ],
        headerRow: false,
        headerColumn: false,
    };
}

/** Block types whose content is editable text. */
export function isEditableType(type: BlockType): boolean {
    return type !== 'divider' && type !== 'table' && type !== 'image';
}
