import {memo, useCallback, useLayoutEffect, useRef} from 'react';
import type {ClipboardEvent, DragEvent, KeyboardEvent, MouseEvent, ReactNode} from 'react';

import AttachmentImage from './AttachmentImage';
import TableBlock from './TableBlock';
import {blockLabel} from './blockConfig';
import {stripZeroWidth} from './caret';
import {CheckIcon, DragIcon, PlusIcon} from './icons';
import type {Block as BlockData, ImageData} from './types';

export interface BlockHandlers {
    onContentRef: (id: string, el: HTMLDivElement | null) => void;
    onNormalize: (id: string, html: string) => void;
    onInput: (id: string) => void;
    /** IME composition brackets: the editor must not rewrite a block's markup while one is open. */
    onCompositionStart: (id: string) => void;
    onCompositionEnd: (id: string) => void;
    /** Resize / alt-text edits on an image block. */
    onUpdateImage: (id: string, image: Partial<ImageData>) => void;
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>, id: string) => void;
    onPaste: (e: ClipboardEvent<HTMLDivElement>, id: string) => void;
    /** ⌘-click, for following a `[[wiki link]]` under the pointer. */
    onContentMouseDown: (e: MouseEvent<HTMLDivElement>, id: string) => void;
    onFocus: (id: string) => void;
    onBlur: (id: string) => void;
    onToggleTodo: (id: string) => void;
    onToggleCollapse: (id: string) => void;
    onTableCellRef: (id: string, el: HTMLDivElement | null) => void;
    onTableCellInput: (blockId: string, row: number, column: number, html: string) => void;
    onTableCellKeyDown: (
        e: KeyboardEvent<HTMLDivElement>,
        blockId: string,
        row: number,
        column: number,
    ) => void;
    onTableCellPaste: (
        e: ClipboardEvent<HTMLDivElement>,
        blockId: string,
        row: number,
        column: number,
    ) => void;
    onTableCellFocus: (cellId: string) => void;
    onTableAddRow: (blockId: string) => void;
    onTableAddColumn: (blockId: string) => void;
    onTableDeleteRow: (blockId: string, row: number) => void;
    onTableDeleteColumn: (blockId: string, column: number) => void;
    onTableToggleHeaderRow: (blockId: string) => void;
    onTableToggleHeaderColumn: (blockId: string) => void;
    onSelectBlock: (id: string) => void;
    onPlusClick: (e: MouseEvent<HTMLButtonElement>, id: string) => void;
    onHandleClick: (e: MouseEvent<HTMLButtonElement>, id: string) => void;
    onDragStart: (e: DragEvent<HTMLButtonElement>, id: string) => void;
    onDragEnd: () => void;
    onDragOver: (e: DragEvent<HTMLDivElement>, id: string) => void;
    onDrop: (e: DragEvent<HTMLDivElement>, id: string) => void;
}

interface BlockProps {
    block: BlockData;
    listNumber: number;
    selected: boolean;
    dragging: boolean;
    dropEdge: 'before' | 'after' | null;
    placeholder?: string;
    handlers: BlockHandlers;
}

function Block({
    block,
    listNumber,
    selected,
    dragging,
    dropEdge,
    placeholder,
    handlers,
}: BlockProps) {
    const contentRef = useRef<HTMLDivElement | null>(null);

    const setRef = useCallback(
        (el: HTMLDivElement | null) => {
            contentRef.current = el;
            handlers.onContentRef(block.id, el);
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [block.id],
    );

    // Keep the uncontrolled contentEditable in sync with state without clobbering the caret.
    //
    // Deps matter here for a reason that isn't about correctness: reading `el.innerHTML` serializes
    // the block's whole DOM subtree, and with no dependency array every block in the document did
    // that on every render — 110 ms at 2500 blocks for renders that change nothing about the text,
    // like the save-status dot flipping or the note-list cursor moving. The html and the type are
    // the only inputs, so those are the deps.
    useLayoutEffect(() => {
        const el = contentRef.current;
        if (!el || block.type === 'divider' || block.type === 'image') return;
        // Zero-width-insensitive: block state never carries the caret-escape U+200B (stripZeroWidth,
        // see Editor.tsx) but the DOM must keep it, so comparing raw would rewrite the element on
        // the very keystroke that created an inline `<code>`/`<strong>` — dropping the caret out of it.
        if (stripZeroWidth(el.innerHTML) !== block.html) {
            el.innerHTML = block.html;
            // The browser may normalize what we set; adopt its form so this
            // effect doesn't rewrite the DOM (and drop the caret) every render.
            if (el.innerHTML !== block.html) handlers.onNormalize(block.id, el.innerHTML);
        }
    }, [block.html, block.type, block.id, handlers]);

    const editable = block.type !== 'divider' && block.type !== 'table' && block.type !== 'image';

    const content = editable ? (
        <div
            ref={setRef}
            className={`content${block.type === 'todo' && block.checked ? ' todo-checked' : ''}`}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-label={`${blockLabel(block.type)} block`}
            aria-multiline="true"
            spellCheck={block.type !== 'code'}
            data-block-id={block.id}
            data-block-type={block.type}
            data-placeholder={placeholder}
            onInput={() => handlers.onInput(block.id)}
            onCompositionStart={() => handlers.onCompositionStart(block.id)}
            onCompositionEnd={() => handlers.onCompositionEnd(block.id)}
            onMouseDown={(e) => handlers.onContentMouseDown(e, block.id)}
            onKeyDown={(e) => handlers.onKeyDown(e, block.id)}
            onPaste={(e) => handlers.onPaste(e, block.id)}
            onFocus={() => handlers.onFocus(block.id)}
            onBlur={() => handlers.onBlur(block.id)}
        />
    ) : null;

    let body: ReactNode;
    switch (block.type) {
        case 'todo':
            body = (
                <div className="block-row">
                    <div className="todo-col" contentEditable={false}>
                        <button
                            type="button"
                            className={`todo-box${block.checked ? ' checked' : ''}`}
                            role="checkbox"
                            aria-checked={Boolean(block.checked)}
                            aria-label={block.checked ? 'Mark as not done' : 'Mark as done'}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => handlers.onToggleTodo(block.id)}
                        >
                            {block.checked && <CheckIcon />}
                        </button>
                    </div>
                    {content}
                </div>
            );
            break;
        case 'toggle':
            body = (
                <div className="block-row toggle-row">
                    <div className="toggle-col" contentEditable={false}>
                        <button
                            type="button"
                            className={`toggle-button${block.collapsed ? ' collapsed' : ''}`}
                            aria-label={block.collapsed ? 'Expand toggle' : 'Collapse toggle'}
                            aria-expanded={!block.collapsed}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => handlers.onToggleCollapse(block.id)}
                        >
                            <span>▾</span>
                        </button>
                    </div>
                    {content}
                </div>
            );
            break;
        case 'table':
            body = (
                <TableBlock
                    block={block}
                    onCellRef={handlers.onTableCellRef}
                    onCellInput={handlers.onTableCellInput}
                    onCellKeyDown={handlers.onTableCellKeyDown}
                    onCellPaste={handlers.onTableCellPaste}
                    onCellFocus={handlers.onTableCellFocus}
                    onAddRow={handlers.onTableAddRow}
                    onAddColumn={handlers.onTableAddColumn}
                    onDeleteRow={handlers.onTableDeleteRow}
                    onDeleteColumn={handlers.onTableDeleteColumn}
                    onToggleHeaderRow={handlers.onTableToggleHeaderRow}
                    onToggleHeaderColumn={handlers.onTableToggleHeaderColumn}
                />
            );
            break;
        case 'bulleted':
            body = (
                <div className="block-row">
                    {/* An en dash, not a bullet — Apple-Notes style, matching the Markdown
                        editor's `list-style-type: '–  '` (see index.css). */}
                    <div className="list-marker bullet-marker" contentEditable={false}>
                        –
                    </div>
                    {content}
                </div>
            );
            break;
        case 'numbered':
            body = (
                <div className="block-row">
                    <div className="list-marker number-marker" contentEditable={false}>
                        {listNumber}.
                    </div>
                    {content}
                </div>
            );
            break;
        case 'quote':
            body = <div className="quote-wrap">{content}</div>;
            break;
        case 'callout':
            body = (
                <div className="callout-wrap">
                    <div className="callout-emoji" contentEditable={false}>
                        💡
                    </div>
                    {content}
                </div>
            );
            break;
        case 'code':
            body = (
                <div className="code-wrap">
                    <div className="code-lang" contentEditable={false}>
                        Plain text
                    </div>
                    {content}
                </div>
            );
            break;
        case 'divider':
            body = (
                <div className="divider-wrap" onClick={() => handlers.onSelectBlock(block.id)}>
                    <hr />
                </div>
            );
            break;
        case 'image':
            body = (
                <AttachmentImage
                    block={block}
                    onSelect={() => handlers.onSelectBlock(block.id)}
                    onUpdate={(image) => handlers.onUpdateImage(block.id, image)}
                />
            );
            break;
        default:
            body = content;
    }

    const classes = ['block'];
    if (selected) classes.push('selected');
    if (dragging) classes.push('dragging');
    if (dropEdge === 'before') classes.push('drop-before');
    if (dropEdge === 'after') classes.push('drop-after');

    return (
        <div
            className={classes.join(' ')}
            id={block.id}
            data-type={block.type}
            data-depth={block.depth ?? 0}
            data-color={block.color && block.color !== 'default' ? block.color : undefined}
            style={{marginLeft: `${Math.min(block.depth ?? 0, 6) * 26}px`}}
            onDragOver={(e) => handlers.onDragOver(e, block.id)}
            onDrop={(e) => handlers.onDrop(e, block.id)}
        >
            {/* The drag handle is the only furniture in the LEFT margin, so the gutter it needs
                stays narrow; the add button lives in the right margin (see editor.css). */}
            <div className="handles handle-slot handle-slot_left" contentEditable={false}>
                <button
                    type="button"
                    className="handle-btn drag-btn"
                    title="Drag to move. Click to open menu"
                    tabIndex={0}
                    draggable
                    onClick={(e) => handlers.onHandleClick(e, block.id)}
                    onDragStart={(e) => handlers.onDragStart(e, block.id)}
                    onDragEnd={handlers.onDragEnd}
                >
                    <DragIcon />
                </button>
            </div>
            <div className="handles handle-slot handle-slot_right" contentEditable={false}>
                <button
                    type="button"
                    className="handle-btn plus-btn"
                    title="Click to add a block below"
                    tabIndex={0}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => handlers.onPlusClick(e, block.id)}
                >
                    <PlusIcon />
                </button>
            </div>
            <div className="block-body">{body}</div>
        </div>
    );
}

/**
 * Memoized: without it a single keystroke re-rendered every block in the note, because `Editor`
 * re-renders the whole document on each edit. The props are all primitives plus the block object
 * (only the edited block gets a new identity — `setBlocks` maps and replaces just that one) and the
 * `handlers` object, which `Editor` deliberately keeps identity-stable for exactly this reason.
 */
export default memo(Block);
