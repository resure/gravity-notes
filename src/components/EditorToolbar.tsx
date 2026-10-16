import {useCallback, useEffect, useState} from 'react';
import type {RefObject} from 'react';

import {
    ArrowUturnCcwLeft,
    ArrowUturnCwRight,
    Bold,
    ChevronDown,
    Code,
    Italic,
    Link,
    Strikethrough,
    Underline,
} from '@gravity-ui/icons';
import {Button, DropdownMenu, Icon} from '@gravity-ui/uikit';

import type {EditorHandle, InlineMark} from './blockEditor/Editor';
import {MENU_ITEMS} from './blockEditor/blockConfig';
import type {BlockType} from './blockEditor/types';

import './EditorToolbar.css';

const MARKS: {mark: InlineMark; label: string; icon: typeof Bold; command?: string}[] = [
    {mark: 'bold', label: 'Bold (⌘B)', icon: Bold, command: 'bold'},
    {mark: 'italic', label: 'Italic (⌘I)', icon: Italic, command: 'italic'},
    {mark: 'underline', label: 'Underline (⌘U)', icon: Underline, command: 'underline'},
    {mark: 'strike', label: 'Strikethrough (⌘⇧S)', icon: Strikethrough, command: 'strikeThrough'},
    {mark: 'code', label: 'Code (⌘E)', icon: Code},
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

const itemFor = (type: BlockType) => MENU_ITEMS.find((item) => item.type === type);

interface ToolbarState {
    /** The type of the block the caret is in, or null when the caret is not in the editor. */
    type: BlockType | null;
    marks: Set<InlineMark>;
}

function readState(root: HTMLElement | null): ToolbarState {
    const active = document.activeElement;
    if (!root || !(active instanceof HTMLElement) || !root.contains(active)) {
        return {type: null, marks: new Set()};
    }
    // A table cell carries its own `data-block-type="text"`; the block it belongs to is the table.
    const type = (
        active.dataset.tableBlockId ? 'table' : (active.dataset.blockType ?? null)
    ) as BlockType | null;
    const marks = new Set<InlineMark>();
    for (const {mark, command} of MARKS) {
        if (command && document.queryCommandState(command)) marks.add(mark);
    }
    const anchor = window.getSelection()?.anchorNode;
    const element = anchor instanceof Element ? anchor : anchor?.parentElement;
    if (element?.closest('code') && type !== 'code') marks.add('code');
    return {type, marks};
}

interface EditorToolbarProps {
    editorRef: RefObject<EditorHandle>;
    /** The editor's own element, so the toolbar only reflects a caret inside it. */
    rootRef: RefObject<HTMLElement>;
    /** The pane that scrolls, for the hairline the bar takes once content slides under it. */
    scrollContainerRef?: RefObject<HTMLElement>;
}

/**
 * The formatting toolbar (Settings › Show editor toolbar): sticky above the note body, each button
 * running the same action as its keyboard chord or slash command. Buttons never take focus, so the
 * caret and selection they act on stay where they are.
 */
export function EditorToolbar({editorRef, rootRef, scrollContainerRef}: EditorToolbarProps) {
    const [state, setState] = useState<ToolbarState>({type: null, marks: new Set()});
    const [scrolled, setScrolled] = useState(false);

    const refresh = useCallback(() => setState(readState(rootRef.current)), [rootRef]);

    useEffect(() => {
        refresh();
        document.addEventListener('selectionchange', refresh);
        document.addEventListener('focusin', refresh);
        return () => {
            document.removeEventListener('selectionchange', refresh);
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
        icon: React.ReactNode,
        action: (editor: EditorHandle) => void,
        selected = false,
    ) => (
        <Button
            key={key}
            view="flat"
            size="m"
            selected={selected}
            title={label}
            aria-label={label}
            aria-pressed={selected}
            onClick={() => run(action)}
        >
            {icon}
        </Button>
    );

    const currentStyle = TEXT_STYLES.includes(state.type as BlockType) ? state.type : null;

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
                {button('undo', 'Undo (⌘Z)', <Icon data={ArrowUturnCcwLeft} />, (e) => e.undo())}
                {button('redo', 'Redo (⌘⇧Z)', <Icon data={ArrowUturnCwRight} />, (e) => e.redo())}
                <span className="editor-toolbar__divider" />
                <DropdownMenu
                    size="m"
                    renderSwitcher={(props) => (
                        <Button
                            {...props}
                            view="flat"
                            size="m"
                            className="editor-toolbar__style"
                            title="Text style"
                        >
                            {itemFor(state.type ?? 'text')?.label}
                            <Icon data={ChevronDown} size={14} />
                        </Button>
                    )}
                    items={TEXT_STYLES.map((type) => ({
                        text: itemFor(type)?.label,
                        iconStart: (
                            <span className="editor-toolbar__item-icon">{itemFor(type)?.icon}</span>
                        ),
                        selected: type === currentStyle,
                        // After the menu has closed and handed focus back, so the caret lands in the
                        // block and stays there.
                        action: () => window.setTimeout(() => run((e) => e.setBlockType(type)), 0),
                    }))}
                />
                <span className="editor-toolbar__divider" />
                {MARKS.map(({mark, label, icon}) =>
                    button(
                        mark,
                        label,
                        <Icon data={icon} />,
                        (e) => e.format(mark),
                        state.marks.has(mark),
                    ),
                )}
                {button('link', 'Link (⌘K)', <Icon data={Link} />, (e) => e.link())}
                {BLOCK_GROUPS.map((group) => [
                    <span key={`${group[0]}-divider`} className="editor-toolbar__divider" />,
                    ...group.map((type) => {
                        const item = itemFor(type);
                        return button(
                            type,
                            item?.label ?? type,
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
