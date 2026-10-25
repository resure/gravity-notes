import {useCallback, useEffect, useState} from 'react';
import type {ReactNode, RefObject} from 'react';

import {Button} from '../ui/Button';
import {Menu, MenuItem} from '../ui/Menu';
import {Popover} from '../ui/Popover';
import {ChevronDown, Link, Redo, Undo} from '../ui/icons';

import type {EditorHandle, InlineMark} from './blockEditor/Editor';
import {ColorPalette} from './blockEditor/blockColors';
import {MENU_ITEMS} from './blockEditor/blockConfig';
import {subscribeSelectionFrame} from './blockEditor/selectionFrame';
import type {BlockType} from './blockEditor/types';

import './EditorToolbar.css';

// B / I / U / S / <> are type, not icons (§11): set as letterforms in the toolbar's own face.
const MARKS: {
    mark: InlineMark;
    label: string;
    glyph: ReactNode;
    command?: string;
}[] = [
    {mark: 'bold', label: 'Bold (⌘B)', glyph: <b>B</b>, command: 'bold'},
    {mark: 'italic', label: 'Italic (⌘I)', glyph: <i>I</i>, command: 'italic'},
    {mark: 'underline', label: 'Underline (⌘U)', glyph: <u>U</u>, command: 'underline'},
    {
        mark: 'strike',
        label: 'Strikethrough (⌘⇧S)',
        glyph: <s>S</s>,
        command: 'strikeThrough',
    },
    {mark: 'code', label: 'Code (⌘E)', glyph: <span>{'<>'}</span>},
];

const TEXT_STYLES: BlockType[] = [
    'text',
    'heading1',
    'heading2',
    'heading3',
    'heading4',
    'heading5',
    'heading6',
];
const BLOCK_GROUPS: BlockType[][] = [
    ['bulleted', 'numbered', 'todo'],
    ['quote', 'callout', 'toggle'],
    ['code', 'table', 'divider'],
];

const CHORDS: Partial<Record<BlockType, string>> = {
    text: '⌘⌥0',
    heading1: '⌘⌥1',
    heading2: '⌘⌥2',
    heading3: '⌘⌥3',
    todo: '⌘⌥4',
    bulleted: '⌘⌥5',
    numbered: '⌘⌥6',
    toggle: '⌘⌥7',
    code: '⌘⌥8',
};

const itemFor = (type: BlockType) => MENU_ITEMS.find((item) => item.type === type);

interface ToolbarState {
    type: BlockType | null;
    marks: Set<InlineMark>;
    /** A selection, or a caret inside a link: what the link button can act on. */
    linkable: boolean;
}

const EMPTY: ToolbarState = {type: null, marks: new Set(), linkable: false};

function readState(root: HTMLElement | null): ToolbarState {
    const active = document.activeElement;
    if (!root || !(active instanceof HTMLElement) || !root.contains(active)) return EMPTY;
    // A table cell carries its own `data-block-type="text"`; the block it belongs to is the table.
    const type = (
        active.dataset.tableBlockId ? 'table' : (active.dataset.blockType ?? null)
    ) as BlockType | null;
    const marks = new Set<InlineMark>();
    for (const {mark, command} of MARKS) {
        if (command && document.queryCommandState(command)) marks.add(mark);
    }
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    const element = anchor instanceof Element ? anchor : anchor?.parentElement;
    if (element?.closest('code') && type !== 'code') marks.add('code');
    const linkable = !selection?.isCollapsed || Boolean(element?.closest('a'));
    return {type, marks, linkable};
}

interface EditorToolbarProps {
    editorRef: RefObject<EditorHandle>;
    rootRef: RefObject<HTMLElement>;
    scrollContainerRef?: RefObject<HTMLElement>;
}

export function EditorToolbar({editorRef, rootRef, scrollContainerRef}: EditorToolbarProps) {
    const [state, setState] = useState<ToolbarState>(EMPTY);
    const [scrolled, setScrolled] = useState(false);
    const [paletteOpen, setPaletteOpen] = useState(false);

    const refresh = useCallback(
        () =>
            setState((current) => {
                // While one of the toolbar's own popups has focus, keep showing the block it acts on.
                if (document.activeElement?.closest('.ui-pop')) return current;
                const next = readState(rootRef.current);
                const same =
                    next.type === current.type &&
                    next.linkable === current.linkable &&
                    next.marks.size === current.marks.size &&
                    [...next.marks].every((mark) => current.marks.has(mark));
                return same ? current : next;
            }),
        [rootRef],
    );

    useEffect(() => {
        refresh();
        const unsubscribe = subscribeSelectionFrame(refresh);
        document.addEventListener('focusin', refresh);
        return () => {
            unsubscribe();
            document.removeEventListener('focusin', refresh);
        };
    }, [refresh]);

    useEffect(() => {
        const pane = scrollContainerRef?.current;
        if (!pane) return undefined;
        const onScroll = () => setScrolled(pane.scrollTop > 0);
        onScroll();
        pane.addEventListener('scroll', onScroll, {passive: true});
        return () => pane.removeEventListener('scroll', onScroll);
    }, [scrollContainerRef]);

    const run = (action: (editor: EditorHandle) => void) => {
        const editor = editorRef.current;
        if (!editor) return;
        action(editor);
        window.requestAnimationFrame(refresh);
    };

    const button = (
        key: string,
        label: string,
        content: ReactNode,
        action: (editor: EditorHandle) => void,
        selected = false,
        disabled = false,
    ) => (
        <Button
            key={key}
            className="editor-toolbar__button"
            pressed={selected}
            disabled={disabled}
            title={label}
            aria-label={label}
            onClick={() => run(action)}
        >
            {content}
        </Button>
    );

    const currentStyle = TEXT_STYLES.includes(state.type as BlockType) ? state.type : null;
    // Marks need a caret in text; a code block is literal and takes none.
    const canFormat = state.type !== null && state.type !== 'code';

    return (
        <div className={`editor-toolbar${scrolled ? ' editor-toolbar_scrolled' : ''}`}>
            <div
                className="editor-toolbar__row"
                role="toolbar"
                aria-label="Formatting"
                onMouseDown={(event) => {
                    if ((event.target as HTMLElement).closest('button')) event.preventDefault();
                }}
            >
                {button('undo', 'Undo (⌘Z)', <Undo size={15} />, (e) => e.undo())}
                {button('redo', 'Redo (⌘⇧Z)', <Redo size={15} />, (e) => e.redo())}
                <span className="editor-toolbar__divider" />
                <Menu
                    align="start"
                    width={200}
                    trigger={
                        <Button className="editor-toolbar__style" title="Text style">
                            <span>{itemFor(state.type ?? 'text')?.label}</span>
                            <ChevronDown size={12} />
                        </Button>
                    }
                >
                    {TEXT_STYLES.map((type) => (
                        <MenuItem
                            key={type}
                            className={
                                type === currentStyle ? 'editor-toolbar__item_current' : undefined
                            }
                            icon={
                                <span className="editor-toolbar__item-icon">
                                    {itemFor(type)?.icon}
                                </span>
                            }
                            hint={CHORDS[type]}
                            // After the menu has closed and handed focus back, so the caret lands
                            // in the block and stays there.
                            onClick={() =>
                                window.setTimeout(() => run((e) => e.setBlockType(type)), 0)
                            }
                        >
                            {itemFor(type)?.label}
                        </MenuItem>
                    ))}
                </Menu>
                <span className="editor-toolbar__divider" />
                {MARKS.map(({mark, label, glyph}) =>
                    button(
                        mark,
                        label,
                        <span className="editor-toolbar__letter">{glyph}</span>,
                        (e) => e.format(mark),
                        state.marks.has(mark),
                        !canFormat,
                    ),
                )}
                <Popover
                    open={paletteOpen}
                    onOpenChange={setPaletteOpen}
                    align="start"
                    initialFocus={false}
                    aria-label="Color"
                    trigger={
                        <Button
                            className="editor-toolbar__button"
                            title="Color"
                            aria-label="Color"
                            disabled={!canFormat}
                        >
                            <span className="editor-toolbar__letter editor-toolbar__letter_color">
                                A
                            </span>
                        </Button>
                    }
                >
                    {/* The editor's own palette, so its scoped styles apply; a press must not
                        take focus from the text it colours. */}
                    {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
                    <div
                        className="gn-block-editor editor-toolbar__palette"
                        onMouseDown={(event) => event.preventDefault()}
                    >
                        <ColorPalette
                            onPick={(color) => {
                                setPaletteOpen(false);
                                run((e) => e.color(color));
                            }}
                        />
                    </div>
                </Popover>
                {button(
                    'link',
                    'Link (⌘K)',
                    <Link size={15} />,
                    (e) => e.link(),
                    false,
                    !canFormat || !state.linkable,
                )}
                {BLOCK_GROUPS.map((group) => [
                    <span key={`${group[0]}-divider`} className="editor-toolbar__divider" />,
                    ...group.map((type) => {
                        const item = itemFor(type);
                        return button(
                            type,
                            CHORDS[type]
                                ? `${item?.label} (${CHORDS[type]})`
                                : (item?.label ?? type),
                            <span className="editor-toolbar__block-icon">{item?.icon}</span>,
                            (e) => e.setBlockType(type),
                            state.type === type,
                        );
                    }),
                ])}
            </div>
        </div>
    );
}
