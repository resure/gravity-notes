import type {ReactNode} from 'react';

import {
    BulletedIcon,
    CalloutIcon,
    CodeIcon,
    DividerIcon,
    H1Icon,
    H2Icon,
    H3Icon,
    H4Icon,
    H5Icon,
    H6Icon,
    ImageIcon,
    NumberedIcon,
    QuoteIcon,
    TableIcon,
    TextIcon,
    TodoIcon,
    ToggleIcon,
} from './icons';
import type {Block, BlockType} from './types';

export interface MenuItemDef {
    type: BlockType;
    label: string;
    /** Markdown shortcut shown right-aligned in the menu. */
    hint?: string;
    keywords: string[];
    icon: ReactNode;
}

export const MENU_ITEMS: MenuItemDef[] = [
    {
        type: 'text',
        label: 'Text',
        keywords: ['text', 'plain', 'paragraph', 'p'],
        icon: <TextIcon />,
    },
    {
        type: 'heading1',
        label: 'Heading 1',
        hint: '#',
        keywords: ['heading', 'h1', '1', 'title'],
        icon: <H1Icon />,
    },
    {
        type: 'heading2',
        label: 'Heading 2',
        hint: '##',
        keywords: ['heading', 'h2', '2', 'subheading'],
        icon: <H2Icon />,
    },
    {
        type: 'heading3',
        label: 'Heading 3',
        hint: '###',
        keywords: ['heading', 'h3', '3', 'subheading'],
        icon: <H3Icon />,
    },
    {
        type: 'heading4',
        label: 'Heading 4',
        hint: '####',
        keywords: ['heading', 'h4', '4', 'subheading'],
        icon: <H4Icon />,
    },
    {
        type: 'heading5',
        label: 'Heading 5',
        hint: '#####',
        keywords: ['heading', 'h5', '5', 'subheading'],
        icon: <H5Icon />,
    },
    {
        type: 'heading6',
        label: 'Heading 6',
        hint: '######',
        keywords: ['heading', 'h6', '6', 'subheading'],
        icon: <H6Icon />,
    },
    {
        type: 'todo',
        label: 'To-do list',
        hint: '[]',
        keywords: ['todo', 'to-do', 'task', 'checkbox', 'check'],
        icon: <TodoIcon />,
    },
    {
        type: 'bulleted',
        label: 'Bulleted list',
        hint: '-',
        keywords: ['bullet', 'bulleted', 'list', 'unordered', 'ul'],
        icon: <BulletedIcon />,
    },
    {
        type: 'numbered',
        label: 'Numbered list',
        hint: '1.',
        keywords: ['numbered', 'number', 'list', 'ordered', 'ol'],
        icon: <NumberedIcon />,
    },
    {
        type: 'toggle',
        label: 'Toggle list',
        hint: '>',
        keywords: ['toggle', 'disclosure', 'collapse', 'details'],
        icon: <ToggleIcon />,
    },
    {
        type: 'table',
        label: 'Table',
        keywords: ['table', 'grid', 'rows', 'columns', 'cells'],
        icon: <TableIcon />,
    },
    {
        type: 'quote',
        label: 'Quote',
        hint: '"',
        keywords: ['quote', 'blockquote', 'citation'],
        icon: <QuoteIcon />,
    },
    {
        type: 'divider',
        label: 'Divider',
        hint: '---',
        keywords: ['divider', 'separator', 'hr', 'rule', 'line'],
        icon: <DividerIcon />,
    },
    {
        type: 'callout',
        label: 'Callout',
        keywords: ['callout', 'banner', 'notice', 'info'],
        icon: <CalloutIcon />,
    },
    {
        type: 'code',
        label: 'Code',
        hint: '```',
        keywords: ['code', 'codeblock', 'snippet', 'pre'],
        icon: <CodeIcon />,
    },
];

/**
 * Slash-menu only: an image is inserted from a file rather than turned into, so it has no place in
 * Turn into or the toolbar, which list MENU_ITEMS.
 */
export const IMAGE_ITEM: MenuItemDef = {
    type: 'image',
    label: 'Image',
    keywords: ['image', 'picture', 'photo', 'img', 'upload'],
    icon: <ImageIcon />,
};

export function filterMenuItems(query: string, withImage = false): MenuItemDef[] {
    const items = withImage ? [...MENU_ITEMS, IMAGE_ITEM] : MENU_ITEMS;
    const q = query.trim().toLowerCase();
    if (!q) return items;
    const score = (value: string) => {
        const v = value.toLowerCase();
        if (v === q) return 0;
        if (v.startsWith(q)) return 1;
        if (v.includes(q)) return 2;
        let i = 0;
        for (const char of v) if (char === q[i]) i += 1;
        return i === q.length ? 3 : Infinity;
    };
    return items
        .map((item, index) => ({
            item,
            index,
            score: Math.min(score(item.label), ...item.keywords.map(score)),
        }))
        .filter((result) => Number.isFinite(result.score))
        .sort((a, b) => a.score - b.score || a.index - b.index)
        .map((result) => result.item);
}

export function blockLabel(type: BlockType): string {
    return MENU_ITEMS.find((i) => i.type === type)?.label ?? 'Text';
}

/** Placeholder for a block; `undefined` means none. */
export function placeholderFor(
    block: Block,
    focused: boolean,
    isOnlyBlock: boolean,
): string | undefined {
    switch (block.type) {
        case 'heading1':
            return 'Heading 1';
        case 'heading2':
            return 'Heading 2';
        case 'heading3':
            return 'Heading 3';
        case 'heading4':
            return 'Heading 4';
        case 'heading5':
            return 'Heading 5';
        case 'heading6':
            return 'Heading 6';
        case 'text':
            return focused || isOnlyBlock ? "Type '/' for commands" : undefined;
        case 'bulleted':
        case 'numbered':
            return focused ? 'List' : undefined;
        case 'todo':
            return focused ? 'To-do' : undefined;
        case 'toggle':
            return focused ? 'Toggle' : undefined;
        case 'quote':
            return focused ? 'Empty quote' : undefined;
        case 'callout':
            return focused ? 'Type something…' : undefined;
        default:
            return undefined;
    }
}

export interface MarkdownRule {
    re: RegExp;
    type: BlockType;
    checked?: boolean;
}

/** Prefix typed before a space that converts the block, e.g. "# " -> heading1. */
export const MARKDOWN_RULES: MarkdownRule[] = [
    {re: /^#$/, type: 'heading1'},
    {re: /^##$/, type: 'heading2'},
    {re: /^###$/, type: 'heading3'},
    {re: /^####$/, type: 'heading4'},
    {re: /^#####$/, type: 'heading5'},
    {re: /^######$/, type: 'heading6'},
    {re: /^[-*+]$/, type: 'bulleted'},
    {re: /^\[\s?\]$/, type: 'todo'},
    {re: /^\[x\]$/i, type: 'todo', checked: true},
    {re: /^\d+[.)]$/, type: 'numbered'},
    {re: /^["“>]$/, type: 'quote'},
];
