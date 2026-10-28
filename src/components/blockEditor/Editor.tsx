import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import type {
    ClipboardEvent,
    DragEvent,
    FocusEvent,
    KeyboardEvent,
    MouseEvent,
    PointerEvent as ReactPointerEvent,
    RefObject,
} from 'react';

import {readClipboardText, writeClipboardText} from '../../clipboard';
import {
    WIKI_LINK_CLASS,
    blocksToMarkdown,
    hasUnsupportedMarkdown,
    inlineHtmlToCodeText,
    inlineHtmlToMarkdown,
    inlineHtmlToText,
    inlineMarkdownToHtml,
    markdownToBlocks,
    takeParsedBlocks,
} from '../../markdown';
import {canCarryColor, colorClassFor, colorFromClass} from '../../markdown/color';
import {openExternalUrl} from '../../openExternal';
import {dirname, formatCrumb, isAttachmentRef} from '../../storage/noteText';
import type {NoteMeta} from '../../storage/types';
import {
    createWikiLinkResolver,
    normalizeTarget,
    splitWikiTarget,
    suggestWikiTargets,
    wikiLinkTargetFor,
} from '../../wikiLinks';

import AnchorEditor from './AnchorEditor';
import Block from './Block';
import type {BlockHandlers} from './Block';
import BlockMenu from './BlockMenu';
import {OVERLAY_HOST_CLASS, OverlayPortal} from './OverlayPortal';
import PickerMenu from './PickerMenu';
import SelectionToolbar from './SelectionToolbar';
import SlashMenu, {SLASH_MENU_ID} from './SlashMenu';
import type {MenuAnchor} from './SlashMenu';
import {tableCellId} from './TableBlock';
import WikiLinkTip from './WikiLinkTip';
import type {WikiSuggestItem} from './WikiSuggestMenu';
import WikiSuggestMenu, {WIKI_MENU_ID, wikiOptionId} from './WikiSuggestMenu';
import {createEdgeScroller} from './autoScroll';
import type {EdgeScroller} from './autoScroll';
import {colorSelection} from './blockColors';
import type {MenuItemDef} from './blockConfig';
import {MARKDOWN_RULES, filterMenuItems, placeholderFor} from './blockConfig';
import {CALLOUT_ITEMS} from './callouts';
import type {CaretPos} from './caret';
import {
    caretAtEnd,
    caretAtStart,
    caretLineRect,
    caretOnFirstLine,
    caretOnLastLine,
    deleteTextRange,
    edgePosition,
    escapeHtml,
    getCaretOffset,
    htmlToText,
    insertPlainTextAtCaret,
    isEmptyHtml,
    isSafeLinkHref,
    lineIsFirst,
    lineIsLast,
    lineRectAt,
    moveCaretOutOfAtom,
    positionNearX,
    rangeTextWithin,
    selectionHtml,
    setCaret,
    setCaretAtPoint,
    splitHtmlAtCaret,
    stripZeroWidth,
    textOffsetOf,
    toggleInlineCode,
    tryInlineMarkdown,
} from './caret';
import {
    MAX_BLOCK_DEPTH,
    addTableColumnData,
    addTableRowData,
    blockRangeIds,
    carryListStarts,
    changeBlockDepth,
    deleteTableColumnData,
    deleteTableRowData,
    duplicateBlockGroups,
    expandBlockIds,
    listNumbers,
    moveBlockSubtrees,
    normalizeDepths,
    pasteTableGrid,
    selectionRoots,
    setTableCell,
} from './documentModel';
import {createHoverStore} from './hoverStore';
import type {HoverStore} from './hoverStore';
import {htmlToBlocks} from './htmlImport';
import {LANGUAGE_ITEMS} from './languages';
import {LONG_DOCUMENT_BLOCKS, useScrollAnchoring} from './scrollAnchoring';
import {subscribeSelectionFrame} from './selectionFrame';
import {
    BLOCK_COLORS,
    BLOCK_TYPES,
    DRAG_SLOP,
    isEditableType,
    newBlock,
    newTableData,
    uid,
    widestRow,
} from './types';
import type {BlockColor, Block as BlockData, BlockType, ColumnAlign, TableData} from './types';
import {URL_LINK_CLASS, decorateUrls} from './urlDecorate';
import {
    WIKI_HIDDEN_CLASS,
    WIKI_LINK_BROKEN_CLASS,
    decorateWikiLinks,
    undecorate as undecorateWikiLinks,
} from './wikiDecorate';

import './editor.css';

interface SlashState {
    blockId: string;
    /** Character offset of the '/' (or of the insertion point for the + button). */
    anchor: number;
    slashLen: 0 | 1;
    query: string;
    rect: MenuAnchor;
}

/** The `[[` note picker's live state: where it was triggered and what has been typed since. */
interface WikiState {
    blockId: string;
    /** Character offset of the first `[` of the trigger. */
    anchor: number;
    query: string;
    rect: MenuAnchor;
}

interface HistoryEntry {
    blocks: BlockData[];
    focusId: string | null;
    caret: number;
}

export interface EditorSnapshot {
    blocks: BlockData[];
    past: HistoryEntry[];
    future: HistoryEntry[];
    markdown: string;
}

interface SelectionBox {
    left: number;
    top: number;
    width: number;
    height: number;
}

type BlocksUpdater = BlockData[] | ((blocks: BlockData[]) => BlockData[]);
type ChangeMode = 'structural' | 'input' | 'silent';

/** Paste allowlist, built from the shared array so it can never fall behind the union. */
const BLOCK_TYPE_SET = new Set<BlockType>(BLOCK_TYPES);
const BLOCK_COLOR_SET = new Set<BlockColor>(BLOCK_COLORS);

/**
 * Set on the editor root while ⌘/Ctrl is held, so CSS can switch links to a pointer cursor — a
 * plain click edits the text, ⌘-click opens the link. See `.gn-block-editor_mod-pressed` in
 * `editor.css`.
 */
const MOD_PRESSED_CLASS = 'gn-block-editor_mod-pressed';
const KEYBOARD_CLASS = 'gn-block-editor_keyboard';
const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift', 'CapsLock']);

const LIST_TYPES: BlockType[] = ['bulleted', 'numbered', 'todo'];
const RESETS_ON_EMPTY_ENTER: BlockType[] = [
    'bulleted',
    'numbered',
    'todo',
    'toggle',
    'quote',
    'callout',
];

/**
 * The two block-level pickers, as a table: which list they show, which field on the block they
 * write, and what the button reads when the field is unset. A third (a table's alignment, an
 * image's fit) is a row here rather than a branch at each of five places.
 */
const PICKERS = {
    language: {
        label: 'Languages',
        filterable: true,
        items: LANGUAGE_ITEMS,
        field: 'language',
        fallback: undefined,
    },
    callout: {
        label: 'Callout kind',
        filterable: false,
        items: CALLOUT_ITEMS,
        field: 'calloutKind',
        fallback: 'note',
    },
} as const;

/** What to call the block in the toast that refuses it a colour (see `canCarryColor`). */
const COLORLESS_NOUN: Partial<Record<BlockType, string>> = {
    code: 'code block',
    table: 'table',
    divider: 'divider',
    image: 'image',
};

/** The browser's file picker, as a promise; null when cancelled. */
function pickFiles(accept: string): Promise<FileList | null> {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.multiple = true;
        input.addEventListener('change', () => resolve(input.files));
        input.addEventListener('cancel', () => resolve(null));
        input.click();
    });
}

/** With the caret inside a link, select the whole link so the link box edits it. */
function selectLinkAtCaret(root: HTMLElement): boolean {
    const selection = window.getSelection();
    if (!selection?.isCollapsed || !selection.anchorNode) return false;
    const node = selection.anchorNode;
    const link = (node instanceof Element ? node : node.parentElement)?.closest('a');
    if (!link || !root.contains(link)) return false;
    const range = document.createRange();
    range.selectNodeContents(link);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
}

// Notion's chords. Matched on the physical key: ⌥ rewrites the character on macOS.
const BLOCK_TYPE_CHORDS: Record<string, BlockType> = {
    Digit0: 'text',
    Digit1: 'heading1',
    Digit2: 'heading2',
    Digit3: 'heading3',
    Digit4: 'todo',
    Digit5: 'bulleted',
    Digit6: 'numbered',
    Digit7: 'toggle',
    Digit8: 'code',
};

function blockTypeChord(e: {
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    code: string;
    getModifierState?(key: string): boolean;
}): BlockType | null {
    if (!(e.metaKey || e.ctrlKey) || !e.altKey || e.shiftKey) return null;
    // Ctrl+Alt is how Windows and Linux report AltGr, which types `{`, `[` and `}` on many layouts.
    if (!e.metaKey && e.getModifierState?.('AltGraph')) return null;
    return BLOCK_TYPE_CHORDS[e.code] ?? null;
}

/**
 * One line of pasted text, read as inline Markdown — which is what ⌘C in a block writes, so a
 * copied bold word comes back bold rather than as literal asterisks. Plain text inserts natively.
 */
function insertInlineMarkdown(text: string): void {
    const html = sanitizeInlineHtml(inlineMarkdownToHtml(text));
    if (html === escapeHtml(text)) insertPlainTextAtCaret(text);
    else document.execCommand('insertHTML', false, html);
}

/** The index just past `index`'s subtree: where a sibling inserted after it belongs. */
function afterSubtree(blocks: readonly BlockData[], index: number): number {
    const depth = blocks[index]?.depth ?? 0;
    let at = index + 1;
    while (at < blocks.length && (blocks[at].depth ?? 0) > depth) at++;
    return at;
}

/** A heading is one line in Markdown; a break inside one would split it. */
function oneLineIfHeading(type: BlockType, html: string): string {
    return type.startsWith('heading') ? html.replace(/<br\s*\/?>/gi, ' ') : html;
}

/**
 * After a block changes type, a zero blank-line gap it or its successor inherited can make the file
 * mean something else: a paragraph written straight under a list item is that item's lazy
 * continuation, two paragraphs with no gap are one, and a numbered item not starting at 1 cannot
 * interrupt a paragraph. Those gaps go back to the serializer's default.
 */
function settleGaps(blocks: BlockData[], id: string): BlockData[] {
    const at = blocks.findIndex((block) => block.id === id);
    if (at < 0) return blocks;
    const risky = (prev: BlockData, cur: BlockData) =>
        cur.blankBefore === 0 &&
        ((cur.type === 'text' && (LIST_TYPES.includes(prev.type) || prev.type === 'text')) ||
            (prev.type === 'text' && cur.type === 'numbered'));
    let next = blocks;
    for (const index of [at, at + 1]) {
        if (index < 1 || index >= next.length || !risky(next[index - 1], next[index])) continue;
        if (next === blocks) next = [...blocks];
        next[index] = {...next[index], blankBefore: undefined};
    }
    return next;
}

// `yfm` survives "Turn into", so a paragraph that used to be a `{% note %}` still carries one.
function isYfmContainer(block: BlockData): boolean {
    const kind = block.yfm?.kind;
    return (
        (block.type === 'toggle' && kind === 'cut') || (block.type === 'callout' && kind === 'note')
    );
}

/**
 * `range` cut into one range per block it covers. WebKit paints a highlight only inside the
 * editing host its range starts in, so one range across blocks drew as far as the end of the first
 * block; ranges that each stay inside one block paint everywhere.
 */
function perBlockRanges(root: HTMLElement, range: Range): {block: HTMLElement; range: Range}[] {
    const parts: {block: HTMLElement; range: Range}[] = [];
    for (const block of root.querySelectorAll<HTMLElement>('[data-block-id]')) {
        if (!range.intersectsNode(block)) {
            // Document order: once past the range, nothing later can intersect it.
            if (parts.length > 0) break;
            continue;
        }
        const part = document.createRange();
        part.selectNodeContents(block);
        if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0)
            part.setStart(range.startContainer, range.startOffset);
        if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0)
            part.setEnd(range.endContainer, range.endOffset);
        if (!part.collapsed) parts.push({block, range: part});
    }
    return parts;
}

/** The block content element a DOM position sits in. */
function blockElementOf(node: Node | null): HTMLElement | null {
    const start = node instanceof Element ? node : (node?.parentElement ?? null);
    return start?.closest<HTMLElement>('[data-block-id]') ?? null;
}

/** Safari and the desktop shell: a selection there stays inside its editing host (`acrossBlocks`). */
const CLAMPS_SELECTION_TO_HOST =
    typeof navigator !== 'undefined' &&
    /AppleWebKit/.test(navigator.userAgent) &&
    !/Chrome|Chromium|Android/.test(navigator.userAgent);

/** The highlight (and root class) that paint a selection spanning blocks — see the effect. */
const CROSS_SELECTION_HIGHLIGHT = 'gn-cross-blocks';
const CROSS_SELECTION_CLASS = 'gn-block-editor_cross-selection';

/** The `[[wiki link]]` chip a caret position is inside of, or directly against on either side. */
function wikiLinkTouching(node: Node, offset: number): HTMLElement | null {
    const selector = `.${WIKI_LINK_CLASS}`;
    const element = node instanceof Element ? node : node.parentElement;
    const inside = element?.closest<HTMLElement>(selector);
    if (inside) return inside;
    const asLink = (candidate: Node | null | undefined) =>
        candidate instanceof HTMLElement && candidate.matches(selector) ? candidate : null;
    if (node.nodeType === Node.TEXT_NODE) {
        const length = (node as Text).length;
        return (
            (offset === 0 ? asLink(node.previousSibling) : null) ??
            (offset === length ? asLink(node.nextSibling) : null)
        );
    }
    return asLink(node.childNodes[offset - 1]) ?? asLink(node.childNodes[offset]);
}

/** Same members, order-insensitive — a cheap "did the marquee's hit set actually change?" test. */
function sameIds(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) return false;
    for (const id of a) if (!b.has(id)) return false;
    return true;
}

/**
 * The only `class` values a `<span>` may keep: the editor's own style-only `[[wiki link]]` wrapper
 * (see wikiDecorate.ts) and a colour (see markdown/color.ts). Every other span is unwrapped, so
 * nothing outside this file can smuggle styling — or, worse, structure — into a block's html.
 */
const WIKI_SPAN_CLASSES = new Set([
    WIKI_LINK_CLASS,
    `${WIKI_LINK_CLASS} ${WIKI_LINK_BROKEN_CLASS}`,
    WIKI_HIDDEN_CLASS,
]);

/** The class a span may keep, rebuilt from what it means — never the attribute as it arrived. */
function keptSpanClass(className: string): string | null {
    if (WIKI_SPAN_CLASSES.has(className)) return className;
    const color = colorFromClass(className);
    return color ? colorClassFor(color) : null;
}

const SANITIZED_BUDGET = 4_000_000;
const sanitized = new Map<string, string>();
let sanitizedChars = 0;

function sanitizeInlineHtml(html: string): string {
    // Text with none of these parses to a single text node and serializes back unchanged (the parser
    // rewrites CR and drops NUL).
    if (!/[<>&\u00a0\r\0]/.test(html)) return html;
    const known = sanitized.get(html);
    if (known !== undefined) return known;
    const markup = sanitizeMarkup(html);
    const clean = markup === html ? html : markup;
    sanitizedChars += html.length + (clean === html ? 0 : clean.length);
    if (sanitizedChars > SANITIZED_BUDGET) {
        sanitized.clear();
        sanitizedChars = 0;
    }
    sanitized.set(html, clean);
    return clean;
}

function sanitizeMarkup(html: string): string {
    const template = document.createElement('template');
    template.innerHTML = html;
    const allowed = new Set([
        'STRONG',
        'B',
        'EM',
        'I',
        'U',
        'INS',
        'MARK',
        'SUB',
        'SUP',
        'SAMP',
        'S',
        'STRIKE',
        'CODE',
        'A',
        'BR',
        'DIV',
        'P',
        'SPAN',
    ]);
    const elements = [...template.content.querySelectorAll('*')];
    for (const element of elements) {
        if (!allowed.has(element.tagName)) {
            element.replaceWith(...element.childNodes);
            continue;
        }
        const href = element.tagName === 'A' ? (element.getAttribute('href') ?? '') : '';
        const title = element.tagName === 'A' ? element.getAttribute('title') : null;
        // `<https://…>` autolinks are flagged so they can be written back in the same spelling
        // (see inline.ts); losing the flag would silently rewrite them to `[url](url)` on disk.
        const autolink = element.tagName === 'A' && element.hasAttribute('data-autolink');
        const className = element.getAttribute('class') ?? '';
        for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
        if (element.tagName === 'A') {
            // Relative destinations are the common case in a vault, so the test is for schemes that
            // EXECUTE, not for absolute-ness — see isSafeLinkHref.
            if (href !== '' && isSafeLinkHref(href)) {
                element.setAttribute('href', href);
                if (title !== null) element.setAttribute('title', title);
                if (autolink) element.setAttribute('data-autolink', '');
                element.setAttribute('rel', 'noopener noreferrer');
            }
        } else if (element.tagName === 'SPAN') {
            const kept = keptSpanClass(className);
            if (kept) element.setAttribute('class', kept);
            else element.replaceWith(...element.childNodes);
        }
    }
    return template.innerHTML;
}

/**
 * Square up a table to a rectangle of sanitized cells. Deliberately UNCAPPED in both directions:
 * this also runs over every table parsed from disk, and a row/column limit here truncated the note
 * in memory — which the first keystroke then autosaved over the file. A big table is the user's
 * data, not a threat.
 */
function normalizeTableData(value: unknown, firstCell = ''): TableData {
    if (!value || typeof value !== 'object' || !Array.isArray((value as TableData).cells)) {
        return newTableData(firstCell);
    }
    const source = (value as TableData).cells;
    const columnCount = Math.max(1, widestRow(source.filter(Array.isArray)));
    const cells = source
        .filter(Array.isArray)
        .map((row) =>
            Array.from({length: columnCount}, (_, column) =>
                sanitizeInlineHtml(typeof row[column] === 'string' ? row[column] : ''),
            ),
        );
    // Alignment and the written layout come through as well, sized to the squared-up column count.
    // Dropping them here silently undid the fields themselves: a note with a `---:` column passes
    // the round-trip check (which runs on the raw parse, where they still exist) and opens in
    // blocks, and the first keystroke anywhere in the note then wrote the table back left-aligned
    // and re-spaced — a semantic change to a table the user never touched.
    const table = value as TableData;
    const perColumn = <T,>(read: (index: number) => T): T[] =>
        Array.from({length: columnCount}, (_, index) => read(index));
    return {
        cells: cells.length ? cells : [Array(columnCount).fill('')],
        headerRow: Boolean(table.headerRow),
        headerColumn: Boolean(table.headerColumn),
        align: Array.isArray(table.align)
            ? perColumn((index) => {
                  const value_ = table.align?.[index];
                  return COLUMN_ALIGNMENTS.has(value_) ? (value_ as ColumnAlign) : null;
              })
            : undefined,
        widths: Array.isArray(table.widths)
            ? perColumn((index) => {
                  const width = table.widths?.[index];
                  return typeof width === 'number' && Number.isFinite(width) && width >= 0
                      ? Math.floor(width)
                      : 0;
              })
            : undefined,
        pad:
            typeof table.pad === 'number' && Number.isFinite(table.pad) && table.pad >= 0
                ? Math.floor(table.pad)
                : undefined,
    };
}

const COLUMN_ALIGNMENTS = new Set<unknown>(['left', 'center', 'right']);

/**
 * Put parser output through the same normalisation the editor applies to its own state. Markdown
 * reaching the editor — a note file a user (or another app) hand-edited, or a paste from anywhere —
 * is untrusted input: `markdownToBlocks` never emits markup outside the inline allowlist, and
 * `sanitizeInlineHtml` is the belt to that braces. EVERY path that turns Markdown into blocks goes
 * through here; the plain-text paste path once skipped it, which put a pasted
 * `<a href="javascript:…">` straight into the live contentEditable.
 */
function normalizeParsedBlocks(blocks: BlockData[]): BlockData[] {
    return blocks.map((block) => {
        const html = sanitizeInlineHtml(block.html);
        const depth = Math.max(0, Math.min(6, Number(block.depth) || 0));
        const color =
            typeof block.color === 'string' && BLOCK_COLOR_SET.has(block.color as BlockColor)
                ? (block.color as BlockColor)
                : undefined;
        // Kept as the same object when nothing changes, so the serializer's per-block cache, warmed
        // by the round-trip check, still applies.
        if (
            html === block.html &&
            depth === block.depth &&
            color === block.color &&
            block.type !== 'table' &&
            block.table === undefined
        ) {
            return block;
        }
        return {
            ...block,
            html,
            depth,
            table: block.type === 'table' ? normalizeTableData(block.table) : undefined,
            color,
        };
    });
}

type Decorate = (html: string, type: BlockType) => string;

function decorateBlock(block: BlockData, decorate: Decorate): BlockData {
    const html = block.html ? decorate(block.html, block.type) : block.html;
    return html === block.html ? block : {...block, html};
}

/** Parse a note's Markdown into the editor's blocks (an empty note still gets one block to type in). */
function documentFromMarkdown(markdown: string, decorate: Decorate): BlockData[] {
    const parsed = takeParsedBlocks(markdown) ?? markdownToBlocks(markdown);
    const blocks = normalizeParsedBlocks(parsed).map((block) => decorateBlock(block, decorate));
    return blocks.length ? blocks : [newBlock()];
}

/**
 * A run of blocks as Markdown — the plain-text half of a copy.
 *
 * Serialized as ONE document, re-based to the shallowest block in it. Per-block serialization at
 * depth 0 flattened a copied nested list into a single level and dropped the blank lines that
 * separate blocks, so pasting it anywhere outside this editor gave something the copy never showed.
 */
function blocksToClipboardMarkdown(blocks: readonly BlockData[]): string {
    const base = blocks.reduce((min, block) => Math.min(min, block.depth ?? 0), MAX_BLOCK_DEPTH);
    return blocksToMarkdown(blocks.map((block) => ({...block, depth: (block.depth ?? 0) - base})));
}

/**
 * The blocks the reader can actually see: a collapsed toggle hides every deeper block beneath it.
 * The render needs this, and so does any path that MERGES one block into another — a merge target
 * the user can't see swallows their text into a collapsed section, which reads as a deletion.
 */
function visibleBlockIds(blocks: BlockData[]): Set<string> {
    const ids = new Set<string>();
    let collapsedDepth: number | null = null;
    for (const block of blocks) {
        const depth = block.depth ?? 0;
        if (collapsedDepth !== null && depth > collapsedDepth) continue;
        collapsedDepth = null;
        ids.add(block.id);
        if (block.type === 'toggle' && block.collapsed) collapsedDepth = depth;
    }
    return ids;
}

/**
 * Where the caret sits, in terms that survive the editor being torn down and rebuilt: block ids are
 * minted per parse, so a note switch and back cannot address a block by id. An INDEX can, as long as
 * the document hasn't been restructured meanwhile — and if it has, the restore simply clamps.
 */
export interface EditorCaret {
    block: number;
    offset: number;
}

export type InlineMark = 'bold' | 'italic' | 'underline' | 'strike' | 'code';

export interface EditorHandle {
    /** Put the caret back in the body (the shell's focus ladder). */
    focus(): void;
    format(mark: InlineMark): void;
    link(): void;
    /** Colour the selected text, or — with nothing selected — the block the caret is in. */
    color(color: BlockColor): void;
    /**
     * Make the block the caret is in (or the selected blocks) this type, as the slash menu does; a
     * block already of that type goes back to text. A divider or table is inserted after a block
     * that has text.
     */
    setBlockType(type: BlockType): void;
    undo(): void;
    redo(): void;
    /** Open a fresh empty block above everything and land on it (Enter from the note title). */
    insertBlockAtTop(): void;
    /** The caret's current position, or null when focus isn't in an editable block. */
    getCaret(): EditorCaret | null;
    snapshot(): EditorSnapshot;
}

export interface EditorProps {
    /** The note's Markdown body. Read ONCE, at mount: the host remounts the editor per note. */
    value: string;
    /** Focus the body on mount (a committed note); the host owns title focus. */
    autofocus?: 'body' | 'title' | null;
    /** Where to put the caret when `autofocus` is 'body' — a position saved before a note switch. */
    initialCaret?: EditorCaret | null;
    /** A session of this same note to pick up instead of parsing `value`; it must serialize to it. */
    resume?: EditorSnapshot | null;
    /**
     * Every note (id + title), for `[[wiki link]]` resolution: the broken-link styling and the `[[`
     * picker's ranking both read it. Empty is safe — every link then simply renders unbroken.
     */
    notes?: NoteMeta[];
    /** The open note's id, so a link never resolves to (or suggests) the note it's written in. */
    noteId?: string;
    /** Fires on every edit with the note's full Markdown; the shell debounces the actual write. */
    onChange(markdown: string): void;
    /** Follow a `[[wiki link]]`; the shell resolves the target title to a note. */
    onWikiLinkNavigate?(target: string): void;
    /**
     * Store a pasted/dropped image in the workspace and return its root-relative
     * `Attachments/…` reference (null if it could not be stored).
     */
    onAttachFile?(file: File): Promise<string | null>;
    /** Escape with nothing else to dismiss — the shell walks focus back to the list. */
    onEscape?(): void;
    /**
     * The caret is leaving the top of the body (ArrowUp or Backspace on the first block). The host
     * owns the note title that sits above, so it decides where focus goes.
     */
    onLeaveTop?(): void;
    /**
     * The editor is mounted but not on screen — read-only preview is showing over it. The host keeps
     * it mounted (a remount would lose the undo history and the caret), so this is what tells it to
     * stand down: its floating overlays PORTAL to `<body>` at `position: fixed`, so hiding the
     * editor's own subtree left them visible and clickable on top of a surface documented as
     * read-only, and their actions still committed edits to the note.
     */
    hidden?: boolean;
    /** The host shows its own formatting toolbar, so the floating one keeps only its link box. */
    toolbarShown?: boolean;
    /** ⌘-click on a link to a stored file — the host reveals it (there is no URL to open). */
    onOpenAttachment?: (ref: string) => void;
    /**
     * The element that scrolls this editor — the host pane, which owns the scrollbar. Handed down
     * rather than discovered, so the auto-scroll during a drag moves the same element the host's
     * own scroll restore writes to.
     */
    scrollContainerRef?: RefObject<HTMLElement | null>;
}

const EMPTY_NOTES: NoteMeta[] = [];

const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
    {
        value,
        autofocus,
        initialCaret,
        resume,
        notes = EMPTY_NOTES,
        noteId = '',
        onChange,
        onWikiLinkNavigate,
        onLeaveTop,
        onAttachFile,
        onEscape,
        onOpenAttachment,
        hidden = false,
        toolbarShown = false,
        scrollContainerRef,
    },
    ref,
) {
    // Resolution is rebuilt only when the note SET changes (a create/rename/move/delete), never on a
    // plain autosave: `notes` gets a fresh array identity on every re-list, so keying on the array
    // itself would rebuild the index — and re-decorate the whole document — after every keystroke's
    // save. The signature is the cheap invariant.
    const wikiSignature = useMemo(() => notes.map((note) => note.id).join('\n'), [notes]);
    const isWikiLinkBroken = useMemo(() => {
        const resolve = createWikiLinkResolver(notes);
        return (target: string) => resolve(target, noteId) === null;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `notes` only matters by signature
    }, [wikiSignature, noteId]);
    const decorate = useMemo(
        (): Decorate => (html, type) =>
            // In code `[[` is code (`matrix[[1]]`), not a link: no chip to hide its brackets.
            type === 'code'
                ? undecorateWikiLinks(html)
                : decorateUrls(decorateWikiLinks(html, isWikiLinkBroken)),
        [isWikiLinkBroken],
    );
    // Read live from event handlers and from the imperative handle, which are captured per render
    // but may run against a later one.
    const decorateRef = useRef(decorate);
    decorateRef.current = decorate;
    const notesRef = useRef(notes);
    notesRef.current = notes;
    const noteIdRef = useRef(noteId);
    noteIdRef.current = noteId;

    const [blocks, setBlockState] = useState<BlockData[]>(() =>
        resume
            ? resume.blocks.map((block) => decorateBlock(block, decorate))
            : documentFromMarkdown(value, decorate),
    );
    const [toast, setToast] = useState<string | null>(null);
    const [focusedId, setFocusedId] = useState<string | null>(null);
    // Outlives a blur: the toolbar's text-style menu takes focus before it applies a type.
    const lastFocusedRef = useRef<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [slash, setSlash] = useState<SlashState | null>(null);
    const [slashIndex, setSlashIndex] = useState(0);
    const [wiki, setWiki] = useState<WikiState | null>(null);
    /**
     * The `[[wiki link]]` the caret is sitting in, and where to float its actions. A link is literal
     * TEXT here (that is what makes it Obsidian-compatible), so there is no anchor to hover and no
     * tooltip a browser would give us — without this, re-pointing a link means editing brackets.
     */
    const [linkTip, setLinkTip] = useState<{
        blockId: string;
        start: number;
        end: number;
        /** The text between the brackets, `|alias` and all — what a re-validation compares. */
        inner: string;
        target: string;
        x: number;
        y: number;
        top: number;
    } | null>(null);
    // The link popup's field, while one is open: Edit text (`[[Note|text]]`), or Change note's
    // search with its highlighted row.
    const [tipEdit, setTipEdit] = useState<
        {kind: 'text'; value: string} | {kind: 'note'; query: string; index: number} | null
    >(null);
    const tipEditRef = useRef(tipEdit);
    tipEditRef.current = tipEdit;
    const noteQuery = tipEdit?.kind === 'note' ? tipEdit.query : null;
    // The ordinary `[text](url)` link the caret is in: the same actions as a wiki link's, since an
    // anchor gives no other way to see or change where it points.
    const [anchorTip, setAnchorTip] = useState<{
        anchor: HTMLElement;
        href: string;
        x: number;
        y: number;
    } | null>(null);
    const [wikiIndex, setWikiIndex] = useState(0);
    const [linkRequest, setLinkRequest] = useState(0);
    const [blockMenu, setBlockMenu] = useState<{id: string; x: number; y: number} | null>(null);
    const [anchorEdit, setAnchorEdit] = useState<{id: string; x: number; y: number} | null>(null);
    // The block-level picker (a code block's language, a callout's kind) — one at a time, so one
    // piece of state with the `kind` saying which list it is showing.
    const [picker, setPicker] = useState<{
        kind: 'language' | 'callout';
        id: string;
        x: number;
        y: number;
    } | null>(null);
    // The subtree ROOTS being dragged — several when the drag started inside a block selection.
    const [draggingRoots, setDraggingRoots] = useState<string[] | null>(null);
    const [dropTarget, setDropTarget] = useState<{id: string; edge: 'before' | 'after'} | null>(
        null,
    );
    const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);

    const rootRef = useRef<HTMLDivElement>(null);
    const refs = useRef(new Map<string, HTMLDivElement>());
    const tableRefs = useRef(new Map<string, HTMLDivElement>());
    const focusReq = useRef<{id: string; pos: CaretPos} | null>(null);
    const openMenuFor = useRef<string | null>(null);
    const pendingSlash = useRef<{blockId: string; anchor: number} | null>(null);
    const historyPast = useRef<HistoryEntry[]>(resume?.past ?? []);
    const historyFuture = useRef<HistoryEntry[]>(resume?.future ?? []);
    const typingGroup = useRef<{blockId: string; at: number} | null>(null);
    const selectionAnchor = useRef<string | null>(null);
    const selectionFocus = useRef<string | null>(null);
    const selectionDrag = useRef<{
        pointerId: number;
        startX: number;
        startY: number;
        base: Set<string>;
        moved: boolean;
        // ⌘/Ctrl held: the press adds to the block selection, so it never clears it or places a caret.
        additive: boolean;
        /** Every block's viewport rect, measured ONCE at pointerdown — see onSelectionPointerMove. */
        rects: Array<{id: string; rect: DOMRect}>;
        /** The last hit set actually pushed into state, so an unchanged drag frame is a no-op. */
        hits: Set<string>;
    } | null>(null);
    const selectionWasDragged = useRef(false);
    const toastTimer = useRef<number | null>(null);

    const blocksRef = useRef(blocks);
    blocksRef.current = blocks;
    // Their descendants travel with them, so they have to LOOK dragged too.
    const draggedIds = useMemo(
        () =>
            draggingRoots ? expandBlockIds(blocksRef.current, draggingRoots) : new Set<string>(),
        [draggingRoots],
    );
    const slashRef = useRef(slash);
    slashRef.current = slash;
    const wikiRef = useRef(wiki);
    wikiRef.current = wiki;
    /** Read by async work that resolves after the editor may have gone off screen. */
    const hiddenRef = useRef(hidden);
    hiddenRef.current = hidden;
    /** True between compositionstart/end — see commitHtml, which must not rewrite the DOM then. */
    const composingRef = useRef(false);
    const selectedIdsRef = useRef(selectedIds);
    selectedIdsRef.current = selectedIds;

    // The document-level block-selection listeners, re-pointed at fresh closures every render so the
    // effect that registers them can bind once (see the block-selection section below).
    const selectionListeners = useRef<{
        onKeyDown: (e: globalThis.KeyboardEvent) => void;
        onClipboard: (e: globalThis.ClipboardEvent) => void;
        onMouseDown: (e: globalThis.MouseEvent) => void;
    }>({onKeyDown: () => {}, onClipboard: () => {}, onMouseDown: () => {}});

    const filteredItems = useMemo(
        () => filterMenuItems(slash?.query ?? '', Boolean(onAttachFile)),
        [slash?.query, onAttachFile],
    );

    /**
     * The `[[` picker's rows. Per the spec the LAST row is always `Create "<query>"` unless the
     * query already names an existing note — which is also what keeps the popup open on a query
     * that matches nothing (the Markdown engine's picker closed there, stranding the user
     * mid-link).
     */
    /** The picker's rows for a query: matching notes, then "Create …" when none matches exactly. */
    const wikiItemsFor = (raw: string): WikiSuggestItem[] => {
        const query = raw.trim();
        const matches = suggestWikiTargets(raw, notesRef.current, noteIdRef.current);
        const items: WikiSuggestItem[] = matches.map((note) => ({kind: 'note', note}));
        const exact = matches.some((note) => note.title.toLowerCase() === query.toLowerCase());
        if (query !== '' && !exact) items.push({kind: 'create', title: query});
        return items;
    };
    const wikiItems: WikiSuggestItem[] = useMemo(
        () => (wiki ? wikiItemsFor(wiki.query) : []),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- notes are read live; the signature is the real input
        [wiki?.query, wiki?.blockId, wikiSignature, noteId],
    );
    const noteChangeItems: WikiSuggestItem[] = useMemo(
        () => (noteQuery === null ? [] : wikiItemsFor(noteQuery)),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- as wikiItems
        [noteQuery, wikiSignature, noteId],
    );

    const showToast = (message: string) => {
        if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
        setToast(message);
        toastTimer.current = window.setTimeout(() => setToast(null), 2200);
    };

    const captureHistory = (current: BlockData[]): HistoryEntry => {
        const focusId =
            focusedId && (refs.current.has(focusedId) || tableRefs.current.has(focusedId))
                ? focusedId
                : null;
        const el = focusId ? (refs.current.get(focusId) ?? tableRefs.current.get(focusId)) : null;
        return {blocks: current, focusId, caret: el ? getCaretOffset(el) : 0};
    };

    const setBlocks = (updater: BlocksUpdater, mode: ChangeMode = 'structural', inputId = '') => {
        setBlockState((current) => {
            const next = carryListStarts(
                current,
                typeof updater === 'function' ? updater(current) : updater,
            );
            if (next === current) return current;
            if (mode !== 'silent') {
                const now = Date.now();
                const sameTypingGroup =
                    mode === 'input' &&
                    typingGroup.current?.blockId === inputId &&
                    now - typingGroup.current.at < 900;
                // React may invoke this updater more than once for a single dispatch — always in
                // StrictMode, and on any interrupted or replayed render — so the push has to be
                // idempotent. Identity says it: a re-invocation is handed the SAME `current`, while
                // a genuinely new edit is handed the previous `next`. Without this, every
                // structural edit recorded twice in dev, so the first ⌘Z restored an identical
                // snapshot and appeared to do nothing, and the 100-entry cap held half the depth it
                // claimed. (Typing hid it: `sameTypingGroup` swallowed the second push.)
                const alreadyRecorded =
                    historyPast.current[historyPast.current.length - 1]?.blocks === current;
                if (!sameTypingGroup && !alreadyRecorded) {
                    historyPast.current.push(captureHistory(current));
                    if (historyPast.current.length > 100) historyPast.current.shift();
                }
                // The rest is already idempotent: re-assigning the typing group and clearing the
                // redo stack say the same thing however many times they run.
                typingGroup.current = mode === 'input' ? {blockId: inputId, at: now} : null;
                historyFuture.current = [];
            }
            return next;
        });
    };

    const restoreHistory = (direction: 'undo' | 'redo') => {
        const source = direction === 'undo' ? historyPast.current : historyFuture.current;
        const destination = direction === 'undo' ? historyFuture.current : historyPast.current;
        const entry = source.pop();
        if (!entry) return;
        destination.push(captureHistory(blocksRef.current));
        typingGroup.current = null;
        const before = new Map(blocksRef.current.map((block) => [block.id, block]));
        setBlockState(entry.blocks);
        setSlash(null);
        setBlockMenu(null);
        // A block-mode edit (a selection's Tab, a drag) has no caret to give back; select what it
        // changed instead, or nothing holds the keyboard and the next ⌘Z goes nowhere.
        const visible = visibleBlockIds(entry.blocks);
        const changed = entry.blocks.filter(
            (block) => visible.has(block.id) && before.get(block.id) !== block,
        );
        setSelectedIds(
            entry.focusId || changed.length === 0
                ? new Set()
                : new Set(changed.map((block) => block.id)),
        );
        if (
            entry.focusId &&
            entry.blocks.some(
                (block) =>
                    (block.id === entry.focusId && isEditableType(block.type)) ||
                    (block.type === 'table' && entry.focusId?.startsWith(`${block.id}:cell:`)),
            )
        ) {
            focusReq.current = {id: entry.focusId, pos: entry.caret};
        }
    };

    // Push every edit up as Markdown. The shell (useNotes) owns the debounce, the optimistic
    // concurrency check, and the actual write, so this stays a plain notification — no timer, and
    // deliberately not on the mount pass, which would mark a freshly opened note dirty.
    // The last Markdown this editor is known to agree with. Seeded from the document it loaded, so
    // the effect below can tell a real edit from mere state churn: the browser normalises markup we
    // write into a contentEditable (`onNormalize` in Block.tsx syncs the normalised form back), which
    // changes `blocks` identity WITHOUT changing the note. Emitting on that made simply opening a
    // note dirty it — an autosave, a new mtime, and the note jumping to the top of the list.
    const emittedRef = useRef<string | null>(null);
    if (emittedRef.current === null) emittedRef.current = blocksToMarkdown(blocks);

    useEffect(() => {
        const markdown = blocksToMarkdown(blocks);
        if (markdown === emittedRef.current) return;
        emittedRef.current = markdown;
        onChange(markdown);
    }, [blocks, onChange]);

    /**
     * Re-run the wiki decoration when the note SET changes — a link goes broken when its target is
     * deleted, and unbroken when it's created. Silent, and a no-op for the vast majority of edits:
     * the wrappers carry no text, so `blocksToMarkdown` is byte-identical either way and the change
     * effect above never fires — nothing is autosaved, the document just repaints.
     */
    useEffect(() => {
        setBlocks((current) => {
            const next = current.map((block) => decorateBlock(block, decorate));
            return next.some((block, index) => block !== current[index]) ? next : current;
        }, 'silent');
        // eslint-disable-next-line react-hooks/exhaustive-deps -- setBlocks is a stable closure over refs
    }, [decorate]);

    useImperativeHandle(ref, () => ({
        focus() {
            const target = blocksRef.current.find((block) => isEditableType(block.type));
            if (target) focusNow(target.id, 'end');
        },
        format: applyMark,
        color: applyColor,
        link() {
            const target = activeEditable();
            if (!target) return;
            if (!selectLinkAtCaret(target.el) && window.getSelection()?.isCollapsed) return;
            setLinkRequest((request) => request + 1);
        },
        setBlockType: applyBlockType,
        undo() {
            restoreHistory('undo');
        },
        redo() {
            restoreHistory('redo');
        },
        insertBlockAtTop() {
            const block = newBlock('text');
            setBlocks((current) => [block, ...current]);
            focusReq.current = {id: block.id, pos: 'start'};
        },
        snapshot: () => ({
            blocks: blocksRef.current,
            past: [...historyPast.current],
            future: [...historyFuture.current],
            markdown: emittedRef.current ?? blocksToMarkdown(blocksRef.current),
        }),
        getCaret() {
            const active = document.activeElement;
            const el =
                active instanceof HTMLElement
                    ? active.closest<HTMLElement>('[data-block-id]')
                    : null;
            const id = el?.dataset.blockId;
            if (!el || !id) return null;
            const block = blocksRef.current.findIndex((candidate) => candidate.id === id);
            return block < 0 ? null : {block, offset: getCaretOffset(el)};
        },
    }));

    // Focus intent for this session's first mount, from the host's focus ladder. Only 'body' acts
    // here: the note title is the host's own field, so 'title' is its business, not ours. Runs once
    // — a later render must never steal the caret back.
    useEffect(() => {
        if (autofocus !== 'body') return;
        // A caret saved before the last switch away from this note, when there is one — the block
        // editor is rebuilt per note, so this is what makes switching back land where you left off.
        const saved = initialCaret ? blocksRef.current[initialCaret.block] : undefined;
        if (saved && isEditableType(saved.type)) {
            // The host has already put the scroll back where the reader left it.
            focusNow(saved.id, initialCaret!.offset, true);
            return;
        }
        const target = blocksRef.current.find((block) => isEditableType(block.type));
        if (target) focusNow(target.id, 'end');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(
        () => () => {
            if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
        },
        [],
    );

    // ----- helpers -----

    const indexOf = (id: string) => blocksRef.current.findIndex((b) => b.id === id);
    const findBlock = (id: string) => blocksRef.current.find((b) => b.id === id);

    const clearBlockSelection = () => {
        selectionAnchor.current = null;
        selectionFocus.current = null;
        setSelectedIds(new Set());
    };

    /**
     * Leave no caret and no highlighted text behind when blocks become the selection.
     *
     * A block selection and a text selection are different modes — the keyboard means different
     * things in each — so the editor must not look like it is in both. A caret still blinking
     * inside a highlighted block says the next keystroke will type there, when in fact Backspace
     * would delete the whole block.
     *
     * Scoped to this editor: a caret or a selection anywhere else on the page belongs to somebody
     * else (the note title, the search box) and is none of our business.
     */
    const dropCaret = () => {
        const active = document.activeElement;
        if (active instanceof HTMLElement && rootRef.current?.contains(active)) active.blur();
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;
        const anchor = selection.anchorNode;
        const node = anchor instanceof Element ? anchor : anchor?.parentElement;
        if (node && rootRef.current?.contains(node)) selection.removeAllRanges();
    };

    const selectSingleBlock = (id: string) => {
        dropCaret();
        selectionAnchor.current = id;
        selectionFocus.current = id;
        setSelectedIds(new Set([id]));
    };

    const selectBlockRange = (anchorId: string, focusId: string) => {
        dropCaret();
        selectionAnchor.current = anchorId;
        selectionFocus.current = focusId;
        setSelectedIds(blockRangeIds(blocksRef.current, anchorId, focusId));
    };

    /**
     * Where the arrows move FROM while blocks are selected: the selection's moving end, falling
     * back to the edge of the selected range on the side we're heading. Returns -1 for `focus` when
     * nothing is selected.
     */
    const selectionEnds = (towards: -1 | 1): {focus: number; edge: number} => {
        const blocks = blocksRef.current;
        const indexes = blocks
            .map((block, index) => (selectedIdsRef.current.has(block.id) ? index : -1))
            .filter((index) => index >= 0);
        if (!indexes.length) return {focus: -1, edge: -1};
        // Ascending by construction (map-with-index then filter), so the ends are the min and max.
        const edge = towards === -1 ? indexes[0] : indexes[indexes.length - 1];
        const focusId = selectionFocus.current;
        const found = focusId ? blocks.findIndex((block) => block.id === focusId) : -1;
        return {focus: found >= 0 ? found : edge, edge};
    };

    /** The next block in `direction` that the reader can actually see, or null at either end. */
    const nextVisibleIndex = (from: number, direction: -1 | 1): number | null => {
        const blocks = blocksRef.current;
        const visible = visibleBlockIds(blocks);
        for (let i = from + direction; i >= 0 && i < blocks.length; i += direction) {
            if (visible.has(blocks[i].id)) return i;
        }
        return null;
    };

    /**
     * Reorder the selection by one position. Moves whole SUBTREES (a collapsed toggle takes its
     * children with it, as dragging does), and steps over the neighbour's subtree rather than into
     * it — so one press swaps with the neighbour instead of burrowing through its children. Several
     * selected blocks move as one group, landing together the way a drag of them does.
     */
    const moveSelectedBlocks = (direction: -1 | 1) => {
        const blocks = blocksRef.current;
        const roots = selectionRoots(blocks, selectedIdsRef.current);
        if (roots.length === 0) return;
        const first = blocks.findIndex((block) => block.id === roots[0]);
        const last = blocks.findIndex((block) => block.id === roots[roots.length - 1]);
        if (first < 0 || last < 0) return;
        const visible = visibleBlockIds(blocks);
        // Move among SIBLINGS. Targeting the nearest visible block regardless of depth landed the
        // move inside somebody else's subtree: with `- A` / `  - B` / `C`, moving C up put it
        // between A and B, so B — still at depth 1 — became a child of C instead of A.
        const isSibling = (at: number, depth: number) =>
            visible.has(blocks[at].id) && (blocks[at].depth ?? 0) <= depth;
        if (direction === -1) {
            const depth = blocks[first].depth ?? 0;
            let target = first - 1;
            while (target >= 0 && !isSibling(target, depth)) target -= 1;
            if (target < 0) return;
            moveBlocks(roots, blocks[target].id, 'before');
        } else {
            const depth = blocks[last].depth ?? 0;
            // Past the END of the last subtree first, or the target would be its own child.
            let after = last + 1;
            while (after < blocks.length && (blocks[after].depth ?? 0) > depth) after += 1;
            while (after < blocks.length && !isSibling(after, depth)) after += 1;
            if (after >= blocks.length) return;
            moveBlocks(roots, blocks[after].id, 'after');
        }
        revealBlock(roots[direction === -1 ? 0 : roots.length - 1]);
    };

    /** Keep the block the selection just moved to on screen (the pane scrolls, not the editor). */
    const revealBlock = (id: string) => {
        rootRef.current?.querySelector<HTMLElement>(`[id="${id}"]`)?.scrollIntoView({
            block: 'nearest',
        });
    };

    // Every commit of DOM html into block state strips the caret-escape U+200B (see stripZeroWidth):
    // block state is what gets serialized, so this is the last place it can be caught before the
    // character lands in the user's file. Block.tsx compares the two ends zero-width-insensitively,
    // so the DOM keeps the character (the caret still needs it) without the sync effect fighting it.
    const updateHtml = (id: string, html: string) => {
        const clean = stripZeroWidth(html);
        setBlocks((bs) => bs.map((b) => (b.id === id ? {...b, html: clean} : b)), 'input', id);
    };

    /**
     * Commit a block's live DOM into state, (re)decorating its `[[wiki links]]` on the way.
     *
     * The decoration adds and removes wrapper ELEMENTS but never a character of text, so the caret's
     * plain-text offset is invariant across the rewrite — which is the only reason it is safe to do
     * this on a keystroke: read the offset, swap the markup, put the caret back. Skipped mid-IME
     * composition, where replacing the element's markup would cancel the composition outright.
     */
    const commitHtml = (id: string, el: HTMLElement) => {
        const raw = el.innerHTML;
        if (!composingRef.current) {
            const decorated = decorateRef.current(raw, el.dataset.blockType as BlockType);
            if (decorated !== raw) {
                const focused = document.activeElement === el;
                const offset = focused ? getCaretOffset(el) : 0;
                el.innerHTML = decorated;
                if (focused) setCaret(el, offset);
            }
        }
        updateHtml(id, el.innerHTML);
    };

    const normalizeHtml = (id: string, html: string) => {
        const clean = stripZeroWidth(html);
        setBlocks((bs) => bs.map((b) => (b.id === id ? {...b, html: clean} : b)), 'silent');
    };

    const activeEditable = (): {
        blockId: string;
        el: HTMLElement;
        cell?: {row: number; column: number};
    } | null => {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement)) return null;
        for (const [blockId, el] of refs.current) if (el === active) return {blockId, el};
        for (const [cellId, el] of tableRefs.current) {
            if (el !== active) continue;
            const [blockId, , row, column] = cellId.split(':');
            return {blockId, el, cell: {row: Number(row), column: Number(column)}};
        }
        return null;
    };

    const focusNow = (id: string, pos: CaretPos, preventScroll = false) => {
        const el = refs.current.get(id) ?? tableRefs.current.get(id);
        if (!el) return;
        el.focus({preventScroll});
        setCaret(el, pos);
    };

    /**
     * Leave the top of the body for the note title above it (ArrowUp / Backspace on the first
     * block). The title belongs to the host, so this hands off rather than focusing anything here.
     */
    const focusTitleEnd = () => {
        onLeaveTop?.();
    };

    /**
     * The next block in `dir` the caret can actually land on: editable (or a table, whose cells
     * are), AND visible.
     *
     * Visibility was missing, and this is the one primitive every arrow, Tab and merge handoff goes
     * through — ten call sites. A block hidden inside a collapsed toggle renders no element, so the
     * handoff resolved to it, found no ref, and did nothing while the keystroke had already been
     * `preventDefault`ed: arrows simply stopped working at a collapsed toggle, with no caret
     * movement and no explanation.
     */
    const findEditableSibling = (id: string, dir: -1 | 1): BlockData | null => {
        const bs = blocksRef.current;
        const visible = visibleBlockIds(bs);
        let i = bs.findIndex((b) => b.id === id) + dir;
        while (i >= 0 && i < bs.length) {
            const candidate = bs[i];
            if (
                visible.has(candidate.id) &&
                (isEditableType(candidate.type) || candidate.type === 'table')
            )
                return candidate;
            i += dir;
        }
        return null;
    };

    /** The first (or last) block the caret can sit in — ⌘↑ / ⌘↓ jump there. */
    const edgeEditableBlock = (edge: 'start' | 'end'): BlockData | null => {
        const bs = blocksRef.current;
        const visible = visibleBlockIds(bs);
        const ordered = edge === 'start' ? bs : [...bs].reverse();
        return (
            ordered.find(
                (b) => visible.has(b.id) && (isEditableType(b.type) || b.type === 'table'),
            ) ?? null
        );
    };

    /** Where the caret goes to sit at one end of a block — a table's end is its last cell. */
    const caretTargetIn = (
        block: BlockData,
        edge: 'start' | 'end',
    ): {id: string; pos: CaretPos} => {
        if (block.type !== 'table') return {id: block.id, pos: edge};
        const table = block.table ?? newTableData();
        const row = edge === 'start' ? 0 : table.cells.length - 1;
        const column = edge === 'start' ? 0 : Math.max(0, (table.cells[row]?.length ?? 1) - 1);
        return {id: tableCellId(block.id, row, column), pos: edge};
    };

    /**
     * Run a selection change that crosses blocks. WebKit clamps a selection to the editing host it
     * started in, so `extend` into the next block's contentEditable lands at the END of the
     * current one instead; with the editor's root editable for the duration of the call, both
     * blocks share one host and the selection lands where asked. It survives the root going back
     * (WebKit validates a selection when it is set, not afterwards). WebKit also hands keyboard
     * focus to the root once it is editable, so a block gets it back — without that the next
     * ⇧-arrow landed on the root and never reached the block's handler. That block is the one
     * holding the selection's START: WebKit collapses the selection onto a focused host that does
     * not contain it, which undid every extension upwards or leftwards. Chromium needs none of
     * this, and there the root's flip dropped focus too, and refocusing collapsed the selection.
     */
    const acrossBlocks = (host: HTMLElement, change: () => void) => {
        const root = rootRef.current;
        if (!CLAMPS_SELECTION_TO_HOST || !root || root.isContentEditable) {
            change();
            return;
        }
        root.contentEditable = 'true';
        try {
            change();
        } finally {
            root.removeAttribute('contenteditable');
            if (!blockElementOf(document.activeElement)) {
                const sel = window.getSelection();
                const start = sel?.rangeCount
                    ? blockElementOf(sel.getRangeAt(0).startContainer)
                    : null;
                (start && root.contains(start) ? start : host).focus({preventScroll: true});
            }
        }
    };

    /**
     * ⇧ + an arrow, where the selection's FOCUS sits at the edge of its block: carry it into the
     * neighbouring block, so a text selection grows across blocks from the keyboard the way a mouse
     * drag already makes it. Each block is its own contentEditable, and the browser's own extension
     * stops at the editing host. Inside a block the browser extends as usual; once the selection
     * spans blocks, it is moved here, by line or by character.
     */
    const extendSelectionAcross = (key: string, host: HTMLElement): boolean => {
        const sel = window.getSelection();
        const node = sel?.focusNode;
        if (!sel || !node) return false;
        const el = blockElementOf(node);
        // Tables keep their own cell-to-cell keyboard model.
        if (!el || el.dataset.tableBlockId || !el.dataset.blockId) return false;
        const vertical = key === 'ArrowUp' || key === 'ArrowDown';
        const forward = key === 'ArrowDown' || key === 'ArrowRight';
        let atEdge: boolean;
        let x = 0;
        if (vertical) {
            const line = lineRectAt(el, node, sel.focusOffset);
            if (!line) return false;
            x = line.left;
            atEdge = forward ? lineIsLast(el, line) : lineIsFirst(el, line);
        } else {
            const offset = textOffsetOf(el, node, sel.focusOffset);
            atEdge = forward ? offset >= (el.textContent ?? '').length : offset === 0;
        }
        if (!atEdge) {
            if (el === host && blockElementOf(sel.anchorNode) === host) return false;
            acrossBlocks(host, () =>
                sel.modify(
                    'extend',
                    forward ? 'forward' : 'backward',
                    vertical ? 'line' : 'character',
                ),
            );
            return true;
        }
        const next = findEditableSibling(el.dataset.blockId, forward ? 1 : -1);
        const nextEl = next && next.type !== 'table' ? refs.current.get(next.id) : null;
        if (!nextEl) {
            if (!vertical) return false;
            // No block beyond: run on to this block's own end, the way a last line does natively.
            const [target, offset] = edgePosition(el, forward ? 'end' : 'start');
            acrossBlocks(host, () => sel.extend(target, offset));
            return true;
        }
        const [target, offset] = vertical
            ? positionNearX(nextEl, x, forward ? 'top' : 'bottom')
            : edgePosition(nextEl, forward ? 'start' : 'end');
        acrossBlocks(host, () => sel.extend(target, offset));
        nextEl.scrollIntoView({block: 'nearest'});
        return true;
    };

    const focusNavigableBlock = (block: BlockData, edge: 'start' | 'end') => {
        const {id, pos} = caretTargetIn(block, edge);
        focusNow(id, pos);
    };

    const focusNavigableVertical = (block: BlockData, x: number, edge: 'top' | 'bottom') => {
        if (block.type === 'table') {
            focusNavigableBlock(block, edge === 'top' ? 'start' : 'end');
        } else {
            focusNow(block.id, {x, edge});
        }
    };

    /**
     * Take a keystroke for the editor and keep it here.
     *
     * The app's global shortcuts (`useShortcuts`) listen on `document` and let `mod` chords fire
     * even while a typing surface is focused — so every chord this editor also binds used to run
     * BOTH handlers: ⌘D duplicated the block AND wrote a duplicate note file into the vault, and
     * ⌘K — a note step at the time — opened the link input AND switched notes out from under it,
     * remounting the session over the half-typed link (which is why stepping notes is ⌘⇧J/⌘⇧K
     * now). `preventDefault` alone does nothing about that (the global handler's
     * `defaultPrevented` check is on the bubble path, which a capture-phase claim never reaches,
     * and it is phase-blind besides); stopping propagation is what makes the claim exclusive.
     *
     * Used from BOTH key paths, which is why the parameter is structural rather than React's
     * synthetic type: in block-selection mode the contentEditable is blurred, so events land on
     * `<body>` — an ancestor of React's root container — and are handled by a native listener the
     * editor registers on `document` in the CAPTURE phase (see the selection effect below). That
     * listener has to get in before `useShortcuts`, which registers on `document` at Workspace
     * mount and would otherwise win on registration order.
     */
    const claimChord = (e: {preventDefault(): void; stopPropagation(): void}) => {
        e.preventDefault();
        e.stopPropagation();
    };

    // Deferred focus: applied after React commits the corresponding render.
    useLayoutEffect(() => {
        const req = focusReq.current;
        if (!req) return;
        focusReq.current = null;
        const el = refs.current.get(req.id) ?? tableRefs.current.get(req.id);
        if (!el) {
            openMenuFor.current = null;
            return;
        }
        el.focus();
        setCaret(el, req.pos);
        if (openMenuFor.current === req.id) {
            openMenuFor.current = null;
            openSlashMenu(req.id, getCaretOffset(el), 0);
        }
    });

    // ----- slash menu -----

    const openSlashMenu = (blockId: string, anchor: number, slashLen: 0 | 1) => {
        const el = refs.current.get(blockId);
        const root = rootRef.current;
        if (!el || !root) return;
        const line = caretLineRect(el);
        // VIEWPORT coordinates: the overlays are `position: fixed`. They used to be absolute inside
        // the editor root, which works when the editor owns the page — but Gravity Notes hosts it in
        // a scrolling pane that also carries a `transform` (for a WebKit repaint fix), so a
        // root-relative overlay came out hundreds of pixels off AND was clipped by the pane.
        setSlash({
            blockId,
            anchor,
            slashLen,
            query: '',
            rect: {x: line.left, top: line.top, bottom: line.bottom},
        });
        setSlashIndex(0);
    };

    const applySlashItem = (item: MenuItemDef) => {
        const s = slashRef.current;
        if (!s) return;
        setSlash(null);
        const el = refs.current.get(s.blockId);
        if (!el) return;
        deleteTextRange(el, s.anchor, getCaretOffset(el));
        if (el.innerHTML === '<br>') el.innerHTML = '';
        const rest = stripZeroWidth(el.innerHTML);
        const idx = indexOf(s.blockId);

        if (item.type === 'image') {
            commitHtml(s.blockId, el);
            void pickFiles('image/*').then(async (files) => {
                const images = imageFilesFrom(files);
                if (!images.length) return;
                await insertImageFiles(s.blockId, images);
                // The `/image` line itself becomes the image, rather than a blank row above it.
                if (isEmptyHtml(rest)) {
                    setBlocks((bs) => (bs.length > 1 ? bs.filter((b) => b.id !== s.blockId) : bs));
                }
            });
            return;
        }

        if (item.type === 'divider') {
            if (isEmptyHtml(rest)) {
                const nb = {...newBlock('text'), depth: findBlock(s.blockId)?.depth ?? 0};
                setBlocks((bs) => {
                    const arr = bs.map((b) =>
                        b.id === s.blockId
                            ? {
                                  ...b,
                                  type: 'divider' as BlockType,
                                  html: '',
                                  checked: undefined,
                                  collapsed: undefined,
                              }
                            : b,
                    );
                    arr.splice(idx + 1, 0, nb);
                    return arr;
                });
                focusReq.current = {id: nb.id, pos: 'start'};
            } else {
                const depth = findBlock(s.blockId)?.depth ?? 0;
                const divider = {...newBlock('divider'), depth};
                const nb = {...newBlock('text'), depth};
                setBlocks((bs) => {
                    const arr = bs.map((b) => (b.id === s.blockId ? {...b, html: rest} : b));
                    arr.splice(idx + 1, 0, divider, nb);
                    return arr;
                });
                focusReq.current = {id: nb.id, pos: 'start'};
            }
            return;
        }

        const isTable = item.type === 'table';
        setBlocks((bs) =>
            bs.map((b) =>
                b.id === s.blockId
                    ? {
                          ...b,
                          type: item.type,
                          html: isTable ? '' : rest,
                          table: isTable ? newTableData(rest) : undefined,
                          checked: undefined,
                          collapsed: undefined,
                      }
                    : b,
            ),
        );
        focusReq.current = isTable
            ? {id: tableCellId(s.blockId, 0, 0), pos: 'end'}
            : {id: s.blockId, pos: Math.min(s.anchor, htmlToText(rest).length)};
    };

    // ----- [[ note picker -----

    const openWikiMenu = (blockId: string, anchor: number, query = '') => {
        const el = refs.current.get(blockId);
        if (!el) return;
        // VIEWPORT coordinates, like every other overlay here — see openSlashMenu.
        const line = caretLineRect(el);
        setWiki({
            blockId,
            anchor,
            query,
            rect: {x: line.left, top: line.top, bottom: line.bottom},
        });
        setWikiIndex(0);
    };

    /**
     * Keep the picker in step with what has been typed since the `[[`, or dismiss it. A `]` or a
     * newline in the query means the link is finished (or abandoned), and a caret that has moved
     * back before the trigger means the user is editing elsewhere.
     */
    const syncWikiMenu = (state: WikiState, el: HTMLElement) => {
        // The caret has to still be IN the trigger block. Arrow keys and clicks move it without
        // firing `input`, so without this the picker survived as a ghost pinned to a stale rect —
        // and committing from it addressed offsets in a block that no longer held the selection.
        const anchorNode = window.getSelection()?.anchorNode ?? null;
        if (!anchorNode || !el.contains(anchorNode)) {
            setWiki(null);
            return;
        }
        const text = el.textContent ?? '';
        const offset = getCaretOffset(el);
        if (text.slice(state.anchor, state.anchor + 2) !== '[[' || offset < state.anchor + 2) {
            setWiki(null);
            return;
        }
        const query = text.slice(state.anchor + 2, offset);
        if (/[[\]\n]/.test(query)) {
            setWiki(null);
            return;
        }
        if (query !== state.query) {
            setWiki({...state, query});
            setWikiIndex(0);
        }
    };

    /**
     * Keep the `[[` picker honest about where the caret is.
     *
     * It used to re-sync only on `input`, so every caret move that types nothing — an arrow key,
     * a click, Home/End — left it open with a stale query and a stale anchor rect. `selectionchange`
     * is the only event that covers all of them. Registered ONLY while the picker is open, so the
     * common case pays nothing.
     */
    useEffect(() => {
        if (!wiki) return undefined;
        const onSelectionChange = () => {
            const state = wikiRef.current;
            if (!state) return;
            const el = refs.current.get(state.blockId);
            // No element means the block is gone; nothing to sync against, so close.
            if (!el) {
                setWiki(null);
                return;
            }
            syncWikiMenu(state, el);
        };
        // Not frame-batched: Enter commits against this state, so it has to be current by the next
        // keystroke, and the listener only exists while the picker is open.
        document.addEventListener('selectionchange', onSelectionChange);
        return () => document.removeEventListener('selectionchange', onSelectionChange);
        // Only the open/closed transition matters: the handler reads the live state through refs.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wiki !== null]);

    /**
     * Keep the caret-anchored menus attached to the caret when the view moves.
     *
     * They are `position: fixed` in VIEWPORT coordinates, measured once when they open. Scrolling
     * the pane (or resizing the window) moves the caret underneath them, so the menu stayed where
     * it was and floated over unrelated paragraphs — while still committing into the block it was
     * opened from. Re-measuring is cheap and only runs while one is open.
     *
     * `scroll` is captured because it does not bubble: the pane scrolls, not the document.
     */
    useEffect(() => {
        const open = slash ?? wiki;
        if (!open) return undefined;
        const reposition = (event?: Event) => {
            // The menus scroll internally (`max-height` + `overflow-y: auto`), and that scroll says
            // nothing about where the caret is — re-measuring off it only re-renders the list the
            // user is scrolling.
            if (event?.target instanceof Element && event.target.closest(`.${OVERLAY_HOST_CLASS}`))
                return;
            const state = slashRef.current ?? wikiRef.current;
            if (!state) return;
            const el = refs.current.get(state.blockId);
            if (!el) return;
            const line = caretLineRect(el);
            const rect = {x: line.left, top: line.top, bottom: line.bottom};
            if (slashRef.current) setSlash({...slashRef.current, rect});
            else if (wikiRef.current) setWiki({...wikiRef.current, rect});
        };
        window.addEventListener('scroll', reposition, true);
        window.addEventListener('resize', reposition);
        return () => {
            window.removeEventListener('scroll', reposition, true);
            window.removeEventListener('resize', reposition);
        };
        // Only the open/closed transition matters; the handler reads live state through refs.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slash !== null, wiki !== null]);

    /**
     * Going off screen dismisses every floating overlay. They portal to `<body>` at `position:
     * fixed`, so hiding the editor's own subtree does not hide them — they stayed on top of the
     * read-only preview, still clickable, and their actions still committed edits to the note.
     * Clearing the state as well as skipping the render means coming back does not restore a menu
     * pinned to a caret rect measured before the toggle.
     */
    useEffect(() => {
        if (!hidden) return;
        setSlash(null);
        setWiki(null);
        setBlockMenu(null);
    }, [hidden]);

    /** Commit a picked note (or the "Create …" row, D19: insert-only) as a literal `[[target]]`. */
    const applyWikiItem = (item: WikiSuggestItem) => {
        const state = wikiRef.current;
        if (!state) return;
        setWiki(null);
        const el = refs.current.get(state.blockId);
        if (!el) return;
        const target = linkTargetFor(item);
        // The range to replace comes from the STATE — the `[[` plus the query it was showing — not
        // from wherever the caret happens to be. Reading the live caret meant an arrow key between
        // opening the picker and pressing Enter spliced the link at the wrong offset: one step left
        // turned `Hello [[ab` into `Hello [[ab]]b`, and five steps left dropped it mid-word and left
        // the trigger behind to be backslash-escaped into the file on the next save.
        const text = el.textContent ?? '';
        const end = state.anchor + 2 + state.query.length;
        // Re-validate before touching anything: the text can have moved under a stale state.
        if (text.slice(state.anchor, state.anchor + 2) !== '[[' || end > text.length) return;
        // `deleteTextRange` leaves the caret at `from`, inside this block, so the insert below is
        // deterministic even if the selection had wandered elsewhere.
        deleteTextRange(el, state.anchor, end);
        if (el.innerHTML === '<br>') el.innerHTML = '';
        insertPlainTextAtCaret(`[[${target}]]`);
        commitHtml(state.blockId, el);
    };

    /** What a picked row writes between the brackets. */
    const linkTargetFor = (item: WikiSuggestItem): string =>
        item.kind === 'create'
            ? // A link's inside can hold no bracket, and a `|` would split it into name and text.
              item.title.replace(/[[\]|\n]/g, '')
            : wikiLinkTargetFor(item.note, notesRef.current);

    // ----- block operations -----

    /**
     * Which blocks a gesture actually acts on.
     *
     * `scope` is what the gesture MEANT. A BLOCK selection is a selection of subtrees, so it takes
     * each block's children — `'subtree'`. A TEXT selection means exactly what is highlighted, and
     * expanding it swallowed children the user watched stay unhighlighted (select a paragraph and
     * the first line of a list, press Backspace, and the whole list went) — `'exact'`. Even
     * `'exact'` takes descendants the reader CANNOT see, because a collapsed toggle's summary is
     * all that was ever on screen to select.
     *
     * ONE function because a CUT does both halves: when the clipboard's set and the removed set
     * disagreed, ⌘X into a collapsed toggle destroyed its hidden children and put them on no
     * clipboard, so the paste could not bring them back.
     */
    const blocksInScope = (ids: Iterable<string>, scope: 'subtree' | 'exact'): Set<string> => {
        const bs = blocksRef.current;
        const idSet = new Set(ids);
        if (scope === 'subtree') {
            for (const id of expandBlockIds(bs, ids)) idSet.add(id);
            return idSet;
        }
        const visible = visibleBlockIds(bs);
        for (let i = 0; i < bs.length; i++) {
            if (!idSet.has(bs[i].id)) continue;
            const depth = bs[i].depth ?? 0;
            // Hidden children sit contiguously under their collapsed parent, so the first visible
            // one ends the run.
            for (let c = i + 1; c < bs.length && (bs[c].depth ?? 0) > depth; c++) {
                if (visible.has(bs[c].id)) break;
                idSet.add(bs[c].id);
            }
        }
        return idSet;
    };

    /** Remove blocks, and put the caret somewhere sensible afterwards. */
    const removeBlocks = (ids: string[], scope: 'subtree' | 'exact' = 'subtree') => {
        const bs = blocksRef.current;
        const idSet = blocksInScope(ids, scope);
        const firstIdx = bs.findIndex((b) => idSet.has(b.id));
        let remaining = normalizeDepths(bs.filter((b) => !idSet.has(b.id)));
        let focusId: string | null = null;
        if (remaining.length === 0) {
            const nb = newBlock('text');
            remaining = [nb];
            focusId = nb.id;
        } else {
            // Visibility of what SURVIVES: a block still hidden inside a collapsed toggle can take
            // no focus request (it renders no element), so aiming at one left the editor with focus
            // on <body>, no block selected, and every key doing nothing until the user clicked.
            const stillVisible = visibleBlockIds(remaining);
            const focusable = (b: BlockData) => stillVisible.has(b.id) && isEditableType(b.type);
            for (let i = firstIdx - 1; i >= 0; i--) {
                if (!idSet.has(bs[i].id) && focusable(bs[i])) {
                    focusId = bs[i].id;
                    break;
                }
            }
            if (!focusId) focusId = remaining.find(focusable)?.id ?? null;
        }
        setBlocks(remaining);
        clearBlockSelection();
        if (focusId) focusReq.current = {id: focusId, pos: 'end'};
    };

    const duplicateBlocks = (ids: string[], selectCopies: boolean) => {
        const {blocks: next, copies} = duplicateBlockGroups(blocksRef.current, ids, uid);
        setBlocks(next);
        if (selectCopies) {
            selectionAnchor.current = copies[0]?.id ?? null;
            selectionFocus.current = copies[copies.length - 1]?.id ?? null;
            setSelectedIds(new Set(copies.map((c) => c.id)));
        } else {
            // The LAST copy is a hidden child when a collapsed toggle is duplicated, and a hidden
            // block renders no element for the request to land on — so take the last copy the
            // reader can actually see.
            const visible = visibleBlockIds(next);
            const last = copies.filter((copy) => visible.has(copy.id)).at(-1);
            if (last?.type === 'table')
                focusReq.current = {id: tableCellId(last.id, 0, 0), pos: 'start'};
            else if (last && isEditableType(last.type))
                focusReq.current = {id: last.id, pos: 'end'};
        }
    };

    const retyped = (b: BlockData, type: BlockType): BlockData => ({
        ...b,
        type,
        html:
            type === 'divider' || type === 'table'
                ? ''
                : b.type === 'table'
                  ? (b.table?.cells.flat().filter(Boolean).join('<br>') ?? '')
                  : oneLineIfHeading(type, b.html),
        table:
            type === 'table'
                ? b.type === 'table'
                    ? normalizeTableData(b.table)
                    : newTableData(b.html)
                : undefined,
        checked: undefined,
        collapsed: undefined,
    });

    const turnInto = (id: string, type: BlockType) => {
        setBlocks((bs) =>
            settleGaps(
                bs.map((b) => (b.id === id ? retyped(b, type) : b)),
                id,
            ),
        );
        if (type === 'table') focusReq.current = {id: tableCellId(id, 0, 0), pos: 'end'};
        else if (type !== 'divider') focusReq.current = {id, pos: 'end'};
    };

    const applyMark = (mark: InlineMark) => {
        if (selectionCrossesBlocks()) return;
        const target = activeEditable();
        if (!target || findBlock(target.blockId)?.type === 'code') return;
        if (mark === 'code') {
            toggleInlineCode();
        } else {
            document.execCommand('styleWithCSS', false, 'false');
            document.execCommand(mark === 'strike' ? 'strikeThrough' : mark);
        }
        if (target.cell) {
            const {row, column} = target.cell;
            updateTableCell(target.blockId, row, column, target.el.innerHTML);
        } else {
            commitHtml(target.blockId, target.el);
        }
    };

    const applyColor = (color: BlockColor) => {
        if (selectionCrossesBlocks()) return;
        const target = activeEditable();
        if (target && colorSelection(color, target.el)) {
            if (target.cell) {
                updateTableCell(
                    target.blockId,
                    target.cell.row,
                    target.cell.column,
                    target.el.innerHTML,
                );
            } else {
                commitHtml(target.blockId, target.el);
            }
            return;
        }
        const ids = target ? [target.blockId] : [...selectedIdsRef.current];
        setBlocks((current) =>
            current.map((block) =>
                ids.includes(block.id) && canCarryColor(block.type)
                    ? {...block, color: color === 'default' ? undefined : color}
                    : block,
            ),
        );
    };

    const applyBlockType = (type: BlockType) => {
        const lastFocused = lastFocusedRef.current;
        const lastEl = lastFocused ? refs.current.get(lastFocused) : undefined;
        // The last block only stands in while nothing else holds the keyboard (the style menu just
        // closed); once the caret is in the title or the search box, it is not the target.
        const active = document.activeElement;
        const elsewhere =
            active instanceof HTMLElement &&
            (active.isContentEditable ||
                active.tagName === 'INPUT' ||
                active.tagName === 'TEXTAREA');
        const target =
            activeEditable() ??
            (selectedIdsRef.current.size === 0 && lastFocused && lastEl && !elsewhere
                ? {blockId: lastFocused, el: lastEl}
                : null);
        if (!target) {
            if (type === 'divider' || type === 'table') return;
            // One step for the whole selection, and only the blocks the reader can see.
            const visible = visibleBlockIds(blocksRef.current);
            const ids = new Set(
                [...selectedIdsRef.current].filter((id) => {
                    const block = findBlock(id);
                    return block && visible.has(id) && isEditableType(block.type);
                }),
            );
            if (ids.size === 0) return;
            const allAlready = [...ids].every((id) => findBlock(id)?.type === type);
            const to = allAlready ? 'text' : type;
            setBlocks((bs) => {
                let next = bs.map((b) => (ids.has(b.id) ? retyped(b, to) : b));
                for (const id of ids) next = settleGaps(next, id);
                return next;
            });
            return;
        }
        if (target.cell) return;
        const block = findBlock(target.blockId);
        if (!block) return;
        if (type !== 'divider' && type !== 'table') {
            turnInto(block.id, block.type === type ? 'text' : type);
            return;
        }
        if (block.type === 'text' && isEmptyHtml(block.html)) {
            turnInto(block.id, type);
            if (type === 'divider') {
                const at = indexOf(block.id);
                const next = blocksRef.current
                    .slice(at + 1)
                    .find((candidate) => isEditableType(candidate.type));
                if (next) {
                    focusReq.current = {id: next.id, pos: 'start'};
                } else {
                    const line = {...newBlock('text'), depth: block.depth ?? 0};
                    setBlocks((current) => [...current, line]);
                    focusReq.current = {id: line.id, pos: 'start'};
                }
            }
            return;
        }
        const inserted = {...newBlock(type), depth: block.depth ?? 0};
        if (type === 'table') inserted.table = newTableData('');
        setBlocks((current) => {
            const at = afterSubtree(
                current,
                current.findIndex((candidate) => candidate.id === block.id),
            );
            return [...current.slice(0, at), inserted, ...current.slice(at)];
        });
        // A divider leaves the caret where it was; a table takes it, to be filled in.
        if (type === 'table') focusReq.current = {id: tableCellId(inserted.id, 0, 0), pos: 'start'};
    };

    const moveBlocks = (srcIds: string[], dstId: string, edge: 'before' | 'after') => {
        // `moveBlockSubtrees` lands the first root at the target's depth, so the result is already
        // legal; normalizing stays as the backstop that keeps the screen and the file agreeing.
        const next = normalizeDepths(moveBlockSubtrees(blocksRef.current, srcIds, dstId, edge));
        if (next !== blocksRef.current) setBlocks(next);
    };

    const withDepthChanged = (blocks: BlockData[], id: string, direction: -1 | 1): BlockData[] => {
        let next = changeBlockDepth(blocks, id, direction);
        if (next === blocks) return blocks;
        // Its gap was measured against a different predecessor — written tight against a closing
        // `</details>`, a list item is swallowed into the HTML block.
        next = next.map((block) =>
            block.id === id && block.blankBefore !== undefined
                ? {...block, blankBefore: undefined}
                : block,
        );
        // Indenting under a COLLAPSED toggle would hide the block being indented: it renders no
        // element, so the caret request lands nowhere and one Tab took both the paragraph and the
        // keyboard away, with no way back but the mouse. Open the toggle instead, which is what
        // the user asked for by putting something inside it.
        if (!visibleBlockIds(next).has(id)) {
            const index = next.findIndex((block) => block.id === id);
            const opened = new Set<string>();
            let level = next[index].depth ?? 0;
            for (let at = index - 1; at >= 0 && level > 0; at--) {
                const depth = next[at].depth ?? 0;
                if (depth >= level) continue; // a sibling or its subtree, not an ancestor
                level = depth;
                if (next[at].type === 'toggle' && next[at].collapsed) opened.add(next[at].id);
            }
            next = next.map((block) =>
                opened.has(block.id) ? {...block, collapsed: false} : block,
            );
        }
        return next;
    };

    const changeDepth = (id: string, direction: -1 | 1) => {
        const next = withDepthChanged(blocksRef.current, id, direction);
        if (next === blocksRef.current) return;
        setBlocks(next);
        focusReq.current = {id, pos: getCaretOffset(refs.current.get(id)!)};
    };

    /**
     * Enter on a block selection goes back to editing it, caret at the end — the counterpart of the
     * Esc that selected it, and what Enter means on every other row in the app. The caret lands in
     * the selection's moving end, so ⇧↓ then Enter carries on where the extension stopped; a block
     * with nothing to edit (a divider, an image) hands off to the nearest one that has.
     */
    const editSelectedBlock = () => {
        const {focus} = selectionEnds(1);
        const block = blocksRef.current[focus];
        if (!block) return;
        const target =
            isEditableType(block.type) || block.type === 'table'
                ? block
                : (findEditableSibling(block.id, -1) ?? findEditableSibling(block.id, 1));
        if (!target) return;
        focusReq.current = caretTargetIn(target, 'end');
        clearBlockSelection();
    };

    /**
     * Tab / ⇧Tab over a BLOCK selection. Only the selection's roots move: each one carries its
     * descendants, so indenting a child that merely came along with its parent would move it twice.
     * The selection itself is left alone — the blocks are still the ones the reader highlighted.
     */
    const changeSelectedDepth = (direction: -1 | 1) => {
        let next = blocksRef.current;
        for (const id of selectionRoots(next, selectedIdsRef.current)) {
            next = withDepthChanged(next, id, direction);
        }
        if (next !== blocksRef.current) setBlocks(next);
    };

    // ----- table operations -----

    const updateTable = (
        id: string,
        updater: (table: TableData) => TableData,
        mode: ChangeMode = 'structural',
        inputId = '',
    ) => {
        setBlocks(
            (current) =>
                current.map((block) =>
                    block.id === id
                        ? {...block, table: updater(block.table ?? newTableData())}
                        : block,
                ),
            mode,
            inputId,
        );
    };

    const updateTableCell = (
        id: string,
        row: number,
        column: number,
        html: string,
        mode: ChangeMode = 'input',
    ) => {
        const cellId = tableCellId(id, row, column);
        const clean = stripZeroWidth(html);
        updateTable(id, (table) => setTableCell(table, row, column, clean), mode, cellId);
    };

    const addTableRow = (id: string, focusColumn = 0) => {
        const block = findBlock(id);
        if (!block?.table) return;
        const table = normalizeTableData(block.table);
        const columns = table.cells[0]?.length ?? 1;
        const row = table.cells.length;
        updateTable(id, addTableRowData);
        focusReq.current = {
            id: tableCellId(id, row, Math.min(focusColumn, columns - 1)),
            pos: 'start',
        };
    };

    const addTableColumn = (id: string) => {
        const block = findBlock(id);
        if (!block?.table) return;
        const table = normalizeTableData(block.table);
        const column = table.cells[0]?.length ?? 0;
        updateTable(id, addTableColumnData);
        focusReq.current = {id: tableCellId(id, 0, column), pos: 'start'};
    };

    const deleteTableRow = (id: string, row: number) => {
        const block = findBlock(id);
        if (!block?.table || block.table.cells.length <= 1) return;
        const nextRow = Math.max(0, Math.min(row, block.table.cells.length - 2));
        updateTable(id, (table) => deleteTableRowData(table, row));
        focusReq.current = {id: tableCellId(id, nextRow, 0), pos: 'start'};
    };

    const deleteTableColumn = (id: string, column: number) => {
        const block = findBlock(id);
        const columns = block?.table?.cells[0]?.length ?? 0;
        if (!block?.table || columns <= 1) return;
        const nextColumn = Math.max(0, Math.min(column, columns - 2));
        updateTable(id, (table) => deleteTableColumnData(table, column));
        focusReq.current = {id: tableCellId(id, 0, nextColumn), pos: 'start'};
    };

    const onTableCellKeyDown = (
        e: KeyboardEvent<HTMLDivElement>,
        blockId: string,
        row: number,
        column: number,
    ) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        const block = findBlock(blockId);
        const table = block?.table ?? null;
        if (!block || !table) return;
        const cellId = tableCellId(blockId, row, column);
        const element = tableRefs.current.get(cellId);
        if (!element) return;
        const mod = e.metaKey || e.ctrlKey;

        // The same chords as `onKeyDown` below, claimed the same way — see claimChord for why
        // preventDefault alone leaks them to the app's global shortcut handler.
        if (mod && !e.altKey) {
            const key = e.key.toLowerCase();
            if (key === 'z') {
                claimChord(e);
                restoreHistory(e.shiftKey ? 'redo' : 'undo');
                return;
            }
            if (!e.shiftKey && key === 'y') {
                claimChord(e);
                restoreHistory('redo');
                return;
            }
            if (!e.shiftKey && ['b', 'i', 'u'].includes(key)) {
                claimChord(e);
                document.execCommand('styleWithCSS', false, 'false');
                document.execCommand(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline');
                updateTableCell(blockId, row, column, element.innerHTML);
                return;
            }
            if (e.shiftKey && key === 's') {
                claimChord(e);
                document.execCommand('styleWithCSS', false, 'false');
                document.execCommand('strikeThrough');
                updateTableCell(blockId, row, column, element.innerHTML);
                return;
            }
            if (!e.shiftKey && key === 'e') {
                claimChord(e);
                toggleInlineCode();
                updateTableCell(blockId, row, column, element.innerHTML);
                return;
            }
            if (!e.shiftKey && key === 'k' && !window.getSelection()?.isCollapsed) {
                claimChord(e);
                setLinkRequest((request) => request + 1);
                return;
            }
            if (!e.shiftKey && key === 'd') {
                claimChord(e);
                duplicateBlocks([blockId], false);
                return;
            }
            if (!e.shiftKey && key === 'a') {
                const text = (element.textContent ?? '').replace(/\u200B/g, '');
                const selectedText = (window.getSelection()?.toString() ?? '').replace(
                    /\u200B/g,
                    '',
                );
                if (text.length === 0 || selectedText.length >= text.length) {
                    claimChord(e);
                    selectSingleBlock(blockId);
                }
                return;
            }
        }

        if (e.key === 'Enter' && !mod) {
            // A cell is one line in a pipe table, so Enter moves down, as in a spreadsheet,
            // rather than letting the browser insert a break the file would flatten.
            e.preventDefault();
            if (e.shiftKey) return;
            if (row < table.cells.length - 1)
                focusNow(tableCellId(blockId, row + 1, column), 'end');
            else addTableRow(blockId);
            return;
        }

        if (e.key === 'Tab') {
            e.preventDefault();
            const columns = table.cells[0]?.length ?? 1;
            const linear = row * columns + column + (e.shiftKey ? -1 : 1);
            if (linear < 0) {
                const previous = findEditableSibling(blockId, -1);
                if (previous) focusNavigableBlock(previous, 'end');
                else focusTitleEnd();
            } else if (linear >= table.cells.length * columns) {
                addTableRow(blockId);
            } else {
                focusNow(
                    tableCellId(blockId, Math.floor(linear / columns), linear % columns),
                    'start',
                );
            }
            return;
        }

        const columns = table.cells[0]?.length ?? 1;
        if (e.key === 'ArrowUp' && !e.shiftKey && !mod && caretOnFirstLine(element)) {
            e.preventDefault();
            const x = caretLineRect(element).left;
            if (row > 0) focusNow(tableCellId(blockId, row - 1, column), {x, edge: 'bottom'});
            else {
                const previous = findEditableSibling(blockId, -1);
                if (previous) focusNavigableVertical(previous, x, 'bottom');
                else focusTitleEnd();
            }
            return;
        }
        if (e.key === 'ArrowDown' && !e.shiftKey && !mod && caretOnLastLine(element)) {
            e.preventDefault();
            const x = caretLineRect(element).left;
            if (row < table.cells.length - 1)
                focusNow(tableCellId(blockId, row + 1, column), {x, edge: 'top'});
            else {
                const next = findEditableSibling(blockId, 1);
                if (next) focusNavigableVertical(next, x, 'top');
            }
            return;
        }
        if (e.key === 'ArrowLeft' && !e.shiftKey && !mod && caretAtStart(element)) {
            e.preventDefault();
            const linear = row * columns + column - 1;
            if (linear >= 0)
                focusNow(
                    tableCellId(blockId, Math.floor(linear / columns), linear % columns),
                    'end',
                );
            else {
                const previous = findEditableSibling(blockId, -1);
                if (previous) focusNavigableBlock(previous, 'end');
                else focusTitleEnd();
            }
            return;
        }
        if (e.key === 'ArrowRight' && !e.shiftKey && !mod && caretAtEnd(element)) {
            const linear = row * columns + column + 1;
            if (linear < table.cells.length * columns) {
                e.preventDefault();
                focusNow(
                    tableCellId(blockId, Math.floor(linear / columns), linear % columns),
                    'start',
                );
            } else {
                const next = findEditableSibling(blockId, 1);
                if (next) {
                    e.preventDefault();
                    focusNavigableBlock(next, 'start');
                }
            }
            return;
        }

        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            selectSingleBlock(blockId);
        }
    };

    const onTableCellPaste = (
        e: ClipboardEvent<HTMLDivElement>,
        blockId: string,
        row: number,
        column: number,
    ) => {
        e.preventDefault();
        const element = tableRefs.current.get(tableCellId(blockId, row, column));
        const text = e.clipboardData.getData('text/plain');
        if (!element || !text) return;
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed && /^https?:\/\/\S+$/i.test(text.trim())) {
            document.execCommand('createLink', false, text.trim());
            updateTableCell(blockId, row, column, element.innerHTML);
            return;
        }
        if (!text.includes('\n') && !text.includes('\t')) {
            insertInlineMarkdown(text);
            updateTableCell(blockId, row, column, element.innerHTML);
            return;
        }
        // The trailing newline Excel, Sheets and most web tables put on a copied range is a line
        // TERMINATOR, not an empty row — pasting it wrote a blank over the cell below the paste.
        const matrix = text
            .replace(/\r/g, '')
            .replace(/\n$/, '')
            .split('\n')
            .map((line) => line.split('\t'));
        const block = findBlock(blockId);
        if (!block?.table) return;
        const escapedMatrix = matrix.map((line) => line.map(escapeHtml));
        updateTable(blockId, (table) => pasteTableGrid(table, row, column, escapedMatrix));
        focusReq.current = {
            id: tableCellId(
                blockId,
                row + matrix.length - 1,
                column + matrix[matrix.length - 1].length - 1,
            ),
            pos: 'end',
        };
    };

    const syncRichText = (id: string, html: string) => {
        const match = id.match(/^(.*):cell:(\d+):(\d+)$/);
        if (match) updateTableCell(match[1], Number(match[2]), Number(match[3]), html);
        else updateHtml(id, html);
    };

    // ----- key handling -----

    const handleEnter = (block: BlockData, el: HTMLDivElement) => {
        const sel = window.getSelection();
        const hadSelection = Boolean(sel && !sel.isCollapsed);
        if (hadSelection) sel!.deleteFromDocument();
        // The deletion above changed the DOM only; every branch below writes it into state, or the
        // screen and the file disagree until the next keystroke in this block.
        const live = stripZeroWidth(el.innerHTML);
        const empty = isEmptyHtml(el.innerHTML);
        const depth = block.depth ?? 0;

        if (empty && !hadSelection && !isYfmContainer(block)) {
            // An empty nested block steps out a level first, as in Notion — out of the list it
            // ends, or out of the toggle it closes.
            const following = blocksRef.current[indexOf(block.id) + 1];
            if (depth > 0 && (!following || (following.depth ?? 0) < depth)) {
                changeDepth(block.id, -1);
                return;
            }
            // An empty list/quote/callout resets to plain text.
            if (RESETS_ON_EMPTY_ENTER.includes(block.type)) {
                setBlocks((bs) =>
                    settleGaps(
                        bs.map((b) =>
                            b.id === block.id
                                ? {
                                      ...b,
                                      type: 'text' as BlockType,
                                      html: '',
                                      checked: undefined,
                                      collapsed: undefined,
                                  }
                                : b,
                        ),
                        block.id,
                    ),
                );
                focusReq.current = {id: block.id, pos: 'start'};
                return;
            }
        }

        // Enter at the start of a non-empty block inserts an empty line above it — a list item
        // gets an empty item, so the list stays one list.
        if (!empty && caretAtStart(el)) {
            const type = LIST_TYPES.includes(block.type) ? block.type : 'text';
            const above = {...newBlock(type), depth, listStart: block.listStart};
            const idx = indexOf(block.id);
            setBlocks((bs) => {
                const arr = bs.map((b) =>
                    b.id === block.id ? {...b, html: live, listStart: undefined} : b,
                );
                arr.splice(idx, 0, above);
                return arr;
            });
            focusReq.current = {id: block.id, pos: 'start'};
            return;
        }

        const [before, after] = splitHtmlAtCaret(el);
        const continueType = LIST_TYPES.includes(block.type) ? block.type : 'text';
        // A sibling inserted here would detach the existing body from its container.
        const intoToggle =
            (block.type === 'toggle' || isYfmContainer(block)) && depth < MAX_BLOCK_DEPTH;
        const nb = {...newBlock(continueType, after), depth: intoToggle ? depth + 1 : depth};
        const idx = indexOf(block.id);
        setBlocks((bs) => {
            const arr = bs.map((b) =>
                b.id === block.id
                    ? {...b, html: before, collapsed: intoToggle ? false : b.collapsed}
                    : b,
            );
            arr.splice(idx + 1, 0, nb);
            return arr;
        });
        focusReq.current = {id: nb.id, pos: 'start'};
    };

    const handleBackspaceAtStart = (block: BlockData, el: HTMLDivElement) => {
        // A styled block first turns back into plain text, like Notion.
        if (block.type !== 'text') {
            setBlocks((bs) =>
                settleGaps(
                    bs.map((b) =>
                        b.id === block.id
                            ? {
                                  ...b,
                                  type: 'text' as BlockType,
                                  checked: undefined,
                                  collapsed: undefined,
                              }
                            : b,
                    ),
                    block.id,
                ),
            );
            focusReq.current = {id: block.id, pos: 'start'};
            return;
        }
        const idx = indexOf(block.id);
        if (idx === 0) {
            if (isEmptyHtml(block.html) && blocksRef.current.length > 1) {
                removeBlocks([block.id]);
            }
            focusTitleEnd();
            return;
        }
        const prev = blocksRef.current[idx - 1];
        if (prev.type === 'divider') {
            setBlocks((bs) => normalizeDepths(bs.filter((b) => b.id !== prev.id)));
            return;
        }
        if (prev.type === 'code') {
            if (isEmptyHtml(el.innerHTML)) {
                setBlocks((bs) => normalizeDepths(bs.filter((b) => b.id !== block.id)));
            }
            focusReq.current = {id: prev.id, pos: 'end'};
            return;
        }
        // A merge target has to be BOTH editable and visible, or the text being merged is lost:
        // an image/table block has no editable content element and its serializer never reads
        // `html`, so the merged text is written into a field nothing ever writes out; a block
        // hidden under a collapsed toggle swallows it where the user cannot see it.
        if (!isEditableType(prev.type) || !visibleBlockIds(blocksRef.current).has(prev.id)) {
            // Nothing to lose when this block is empty — that is the everyday "Enter after an
            // image, changed my mind, ⌫" gesture, so still remove it. With text in it, refuse:
            // the caller has already preventDefault'd, so the keystroke is simply dropped.
            // Losing a keystroke beats losing a paragraph.
            if (isEmptyHtml(el.innerHTML)) {
                removeBlocks([block.id]);
                // `removeBlocks` aims focus at the neighbouring block, but here that neighbour is
                // the image/table (no editable element) or a hidden one (no element at all), so the
                // caret would land nowhere and typing would silently stop. Send it somewhere real:
                // the nearest editable block above, else the note title.
                const above = findEditableSibling(block.id, -1);
                if (above && visibleBlockIds(blocksRef.current).has(above.id)) {
                    focusReq.current = {id: above.id, pos: 'end'};
                } else {
                    focusTitleEnd();
                }
            }
            return;
        }
        const prevEl = refs.current.get(prev.id);
        const joinAt = (prevEl?.textContent ?? htmlToText(prev.html)).length;
        const merged = oneLineIfHeading(
            prev.type,
            (isEmptyHtml(prev.html) ? '' : prev.html) + stripZeroWidth(el.innerHTML),
        );
        // The merged block's children move up under `prev`, which can leave them more than one
        // level deeper than it.
        setBlocks((bs) =>
            normalizeDepths(
                bs
                    .filter((b) => b.id !== block.id)
                    .map((b) => (b.id === prev.id ? {...b, html: merged} : b)),
            ),
        );
        focusReq.current = {id: prev.id, pos: joinAt};
    };

    /**
     * Forward Delete at a block's end pulls the next block's text up into it, as the browser would
     * across a paragraph boundary — each block is its own editing host, so it never does.
     */
    const handleDeleteAtEnd = (block: BlockData, el: HTMLDivElement) => {
        const all = blocksRef.current;
        const visible = visibleBlockIds(all);
        const idx = indexOf(block.id);
        const nextIdx = all.findIndex((candidate, at) => at > idx && visible.has(candidate.id));
        const next = all[nextIdx];
        if (!next) return;
        // Merging a collapsed toggle's summary would leave its hidden children under the merged
        // text, out in the open. Refuse, as Backspace does — only an empty line simply goes.
        const hidesChildren = nextIdx + 1 < all.length && !visible.has(all[nextIdx + 1].id);
        if (hidesChildren) {
            if (nextIdx === idx + 1 && isEmptyHtml(el.innerHTML)) {
                setBlocks((current) => normalizeDepths(current.filter((b) => b.id !== block.id)));
                focusReq.current = {id: next.id, pos: 'start'};
            }
            return;
        }
        if (next.type === 'divider') {
            setBlocks((bs) => normalizeDepths(bs.filter((b) => b.id !== next.id)));
            return;
        }
        if (!isEditableType(next.type) || next.type === 'code' || block.type === 'code') return;
        const joinAt = (el.textContent ?? '').length;
        const merged = oneLineIfHeading(
            block.type,
            (isEmptyHtml(block.html) ? '' : stripZeroWidth(el.innerHTML)) + next.html,
        );
        setBlocks((bs) =>
            normalizeDepths(
                bs
                    .filter((b) => b.id !== next.id)
                    .map((b) => (b.id === block.id ? {...b, html: merged} : b)),
            ),
        );
        focusReq.current = {id: block.id, pos: joinAt};
    };

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>, id: string) => {
        const block = findBlock(id);
        const el = refs.current.get(id);
        if (!block || !el) return;
        if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return;

        // Slash menu keyboard navigation.
        if (slash && slash.blockId === id) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const n = filteredItems.length;
                if (n > 0)
                    setSlashIndex((i) => (e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n));
                return;
            }
            if ((e.key === 'Enter' || e.key === 'Tab') && filteredItems.length > 0) {
                e.preventDefault();
                applySlashItem(filteredItems[Math.min(slashIndex, filteredItems.length - 1)]);
                return;
            }
            if (e.key === 'Escape') {
                // Dismissing the menu is the whole action: without stopping the event it also
                // bubbled to the pane's Esc ladder (EditorPane), which walked focus out to the
                // note list on the same keystroke.
                e.preventDefault();
                e.stopPropagation();
                setSlash(null);
                return;
            }
            if ((e.key === 'Enter' || e.key === 'Tab') && filteredItems.length === 0) {
                setSlash(null);
            }
        }

        // `[[` note picker — same keyboard contract as the slash menu above.
        if (wiki && wiki.blockId === id) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                const n = wikiItems.length;
                // With no items there is no popup on screen (the render is gated on the same
                // count), so swallowing the arrows would trap the caret in the block with nothing
                // explaining why. Drop the picker and let the keystroke navigate, exactly as the
                // slash menu's empty-list fallback does.
                if (n === 0) {
                    setWiki(null);
                    return;
                }
                e.preventDefault();
                setWikiIndex((i) => (e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n));
                return;
            }
            if ((e.key === 'Enter' || e.key === 'Tab') && wikiItems.length > 0) {
                e.preventDefault();
                applyWikiItem(wikiItems[Math.min(wikiIndex, wikiItems.length - 1)]);
                return;
            }
            if (e.key === 'Escape') {
                // Dismissing the picker is the whole action — see the slash menu's Escape.
                e.preventDefault();
                e.stopPropagation();
                setWiki(null);
                return;
            }
        }

        const mod = e.metaKey || e.ctrlKey;

        // ⌘↵ on a `[[wiki link]]` follows it (⌘-click does the same with the pointer). Shift is
        // excluded: ⌘⇧↵ is the app's global "new note" chord, and this fired alongside it.
        if (mod && !e.shiftKey && e.key === 'Enter' && followWikiLink(id, getCaretOffset(el))) {
            claimChord(e);
            return;
        }
        // Otherwise ⌘↵ in a to-do ticks it, rather than splitting the line.
        if (mod && !e.shiftKey && !e.altKey && e.key === 'Enter' && block.type === 'todo') {
            claimChord(e);
            setBlocks((bs) => bs.map((b) => (b.id === id ? {...b, checked: !b.checked} : b)));
            return;
        }

        const chordType = blockTypeChord(e);
        if (chordType) {
            claimChord(e);
            applyBlockType(chordType);
            return;
        }

        if (mod && !e.altKey) {
            const k = e.key.toLowerCase();
            if (k === 'z') {
                claimChord(e);
                restoreHistory(e.shiftKey ? 'redo' : 'undo');
                return;
            }
            if (!e.shiftKey && k === 'y') {
                claimChord(e);
                restoreHistory('redo');
                return;
            }
            // Formatting acts inside one block; across blocks the engine would format the first
            // block's part only, and ⌘E would move other blocks' React-owned DOM into a <code>.
            if (
                ((!e.shiftKey && ['b', 'i', 'u', 'e', 'k'].includes(k)) ||
                    (e.shiftKey && k === 's')) &&
                selectionCrossesBlocks()
            ) {
                claimChord(e);
                return;
            }
            if (!e.shiftKey && (k === 'b' || k === 'i' || k === 'u')) {
                claimChord(e);
                if (block.type !== 'code') {
                    document.execCommand('styleWithCSS', false, 'false');
                    document.execCommand(k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline');
                    commitHtml(id, el);
                }
                return;
            }
            if (!e.shiftKey && k === 'k' && block.type !== 'code') {
                // With nothing selected and no link under the caret there is nothing to link, so
                // the chord is left alone rather than swallowed — nothing else binds it.
                if (selectLinkAtCaret(el) || !window.getSelection()?.isCollapsed) {
                    claimChord(e);
                    setLinkRequest((request) => request + 1);
                }
                return;
            }
            if (e.shiftKey && k === 's') {
                claimChord(e);
                if (block.type !== 'code') {
                    document.execCommand('styleWithCSS', false, 'false');
                    document.execCommand('strikeThrough');
                    commitHtml(id, el);
                }
                return;
            }
            if (!e.shiftKey && k === 'e') {
                claimChord(e);
                if (block.type !== 'code') {
                    toggleInlineCode();
                    commitHtml(id, el);
                }
                return;
            }
            if (!e.shiftKey && k === 'd') {
                claimChord(e);
                duplicateBlocks([id], false);
                return;
            }
            if (!e.shiftKey && k === 'a') {
                const text = (el.textContent ?? '').replace(/\u200B/g, '');
                const selText = (window.getSelection()?.toString() ?? '').replace(/\u200B/g, '');
                if (text.length === 0 || selText.length >= text.length) {
                    // Also keeps the event away from the document-level listener that the
                    // block-selection effect registers synchronously.
                    claimChord(e);
                    el.blur();
                    setSelectedIds(new Set(blocksRef.current.map((b) => b.id)));
                }
                return;
            }
        }

        if (e.key === '/' && !mod && !e.altKey && block.type !== 'code' && !slash) {
            const offset = getCaretOffset(el);
            const before = (el.textContent ?? '').slice(0, offset).replace(/\u200B/g, '');
            if (before === '' || /\s$/.test(before)) {
                pendingSlash.current = {blockId: id, anchor: offset};
            }
            return;
        }

        if (e.key === ' ' && !mod && block.type === 'text' && !slash) {
            const sel = window.getSelection();
            if (sel && sel.isCollapsed) {
                const offset = getCaretOffset(el);
                const prefix = (el.textContent ?? '').slice(0, offset).replace(/\u200B/g, '');
                for (const rule of MARKDOWN_RULES) {
                    if (rule.re.test(prefix)) {
                        e.preventDefault();
                        deleteTextRange(el, 0, offset);
                        if (el.innerHTML === '<br>') el.innerHTML = '';
                        const html = stripZeroWidth(el.innerHTML);
                        setBlocks((bs) =>
                            bs.map((b) =>
                                b.id === id
                                    ? {
                                          ...b,
                                          type: rule.type,
                                          html,
                                          checked: rule.checked,
                                          listStart:
                                              rule.type === 'numbered'
                                                  ? Number.parseInt(prefix, 10)
                                                  : undefined,
                                          collapsed: undefined,
                                      }
                                    : b,
                            ),
                        );
                        focusReq.current = {id, pos: 'start'};
                        return;
                    }
                }
            }
            return;
        }

        // A selection dragged across block boundaries is one document selection over several
        // separate contentEditables, and every key that would REPLACE it — Backspace, Delete,
        // Enter, a typed character — reaches only this block's handler. Both the browser's default
        // and our own `deleteFromDocument` would then edit the other blocks' React-owned DOM behind
        // React's back, so the removed text came back on the next render. The edit is made here
        // instead, on what the selection covers; where an end isn't a text block, whole blocks go,
        // as the equivalent block selection would.
        const typed = e.key.length === 1 && !mod && !e.altKey;
        if (
            (e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Enter' || typed) &&
            !(mod && e.shiftKey) &&
            crossesBlocks()
        ) {
            const spanned = selectionBlockIds();
            if (spanned.length > 1) {
                e.preventDefault();
                const ends = textSelectionAcross(spanned);
                if (!ends) removeBlocks(spanned, 'exact');
                else if (e.key === 'Enter') splitAcross(ends);
                else deleteAcross(ends, typed ? e.key : '');
                return;
            }
        }

        if (e.key === 'Enter') {
            // A native soft break — except in a heading, which Markdown cannot break across lines.
            if (e.shiftKey && block.type !== 'code' && !block.type.startsWith('heading')) return;
            e.preventDefault();
            if (block.type === 'code') {
                // The new line starts at the current line's indent, as in any code editor.
                const text = el.textContent ?? '';
                const offset = getCaretOffset(el);
                const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
                const indent = /^[ \t]*/.exec(text.slice(lineStart, offset))?.[0] ?? '';
                insertPlainTextAtCaret(`\n${indent}`);
                commitHtml(id, el);
                return;
            }
            handleEnter(block, el);
            return;
        }

        if (e.key === 'Backspace') {
            // ⌘⇧⌫ is the app's "delete this note" chord; merging blocks under it as well would
            // leave an edit behind the confirm dialog.
            if (mod && e.shiftKey) return;
            const sel = window.getSelection();
            if (!sel || !sel.isCollapsed) return;
            const offset = getCaretOffset(el);
            const before = (el.textContent ?? '').slice(0, offset).replace(/\u200B/g, '');
            if (before !== '') return;
            e.preventDefault();
            handleBackspaceAtStart(block, el);
            return;
        }

        if (e.key === 'Delete' && !mod && !e.altKey && !e.shiftKey) {
            const sel = window.getSelection();
            if (!sel?.isCollapsed || !caretAtEnd(el)) return;
            e.preventDefault();
            handleDeleteAtEnd(block, el);
            return;
        }

        // ⌘⇧C copies the selection as PLAIN text — Markdown syntax stripped — where plain ⌘C
        // copies it as Markdown (see onCopyCut). ⌘⇧V is the mirror: paste text with any Markdown
        // in it flattened, so a snippet from elsewhere arrives as words rather than as markup.
        //
        // Both go through the OS clipboard rather than a clipboard EVENT: a custom chord fires no
        // copy/paste event, which is what `src/clipboard.ts` exists for.
        if (mod && e.shiftKey && e.key.toLowerCase() === 'c') {
            const html = selectionHtml();
            if (!html) return;
            claimChord(e);
            void writeClipboardText(inlineHtmlToText(html)).catch(() => {
                showToast('Could not write to the clipboard');
            });
            return;
        }
        if (mod && e.shiftKey && e.key.toLowerCase() === 'v') {
            claimChord(e);
            void readClipboardText()
                .then((text) => {
                    if (!text) return;
                    // Flatten any Markdown to its text, then insert literally: `**bold**` arrives
                    // as `bold`, not as markup to be re-parsed.
                    const plain = inlineHtmlToText(inlineMarkdownToHtml(text));
                    // The caret can have moved while the read was in flight — only insert if this
                    // block still holds it, or the text would land in whatever the user clicked.
                    // `hiddenRef` is checked separately: entering preview moves FOCUS but not the
                    // document selection, so the anchor test alone still passed and the clipboard
                    // was written into the note behind a read-only surface.
                    if (hiddenRef.current) return;
                    const target = refs.current.get(id);
                    if (!target || !target.contains(window.getSelection()?.anchorNode ?? null))
                        return;
                    const normalized = plain.replace(/\r\n?/g, '\n');
                    const ends = crossesBlocks() ? textSelectionAcross(selectionBlockIds()) : null;
                    if (ends) {
                        pasteInlineAcross(ends, escapeHtml(normalized));
                        return;
                    }
                    insertPlainTextAtCaret(normalized);
                    commitHtml(id, target);
                })
                .catch(() => {
                    showToast('Could not read the clipboard');
                });
            return;
        }

        // ⌘[ / ⌘] outdent and indent, the Notion/Bear convention. Matched on `code` so it is
        // layout-independent (and because ⌥ rewrites the character anyway), and only with NO other
        // modifier: ⌘⌥[ / ⌘⌥] are the app's back/forward and have to reach the global handler.
        if (
            mod &&
            !e.shiftKey &&
            !e.altKey &&
            (e.code === 'BracketLeft' || e.code === 'BracketRight')
        ) {
            claimChord(e);
            changeDepth(id, e.code === 'BracketLeft' ? -1 : 1);
            return;
        }

        if (e.key === 'Tab') {
            e.preventDefault();
            if (block.type === 'code' && e.shiftKey) {
                const text = el.textContent ?? '';
                const offset = getCaretOffset(el);
                const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
                const lead = /^( {1,2}|\t)/.exec(text.slice(lineStart))?.[0];
                if (lead) {
                    deleteTextRange(el, lineStart, lineStart + lead.length);
                    setCaret(el, Math.max(lineStart, offset - lead.length));
                    commitHtml(id, el);
                }
            } else if (block.type === 'code') {
                insertPlainTextAtCaret('  ');
                commitHtml(id, el);
            } else {
                changeDepth(id, e.shiftKey ? -1 : 1);
            }
            return;
        }

        // ⌘↑ / ⌘↓: the start / end of the whole note, as in any text editor. Each block is its own
        // contentEditable, so the native chord only reached the ends of the current block.
        if (mod && !e.shiftKey && !e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            const edge = e.key === 'ArrowUp' ? 'start' : 'end';
            const target = edgeEditableBlock(edge);
            if (target) {
                claimChord(e);
                focusNavigableBlock(target, edge);
            }
            return;
        }

        const arrow =
            e.key === 'ArrowUp' ||
            e.key === 'ArrowDown' ||
            e.key === 'ArrowLeft' ||
            e.key === 'ArrowRight';

        if (e.shiftKey && !mod && !e.altKey && arrow) {
            if (extendSelectionAcross(e.key, el)) e.preventDefault();
            return;
        }

        // A plain arrow on a selection that spans blocks collapses it to the end it points at, the
        // way a text editor does. Left to the browser, which only knows the block with focus, the
        // caret landed somewhere past the selection.
        if (!e.shiftKey && !mod && !e.altKey && arrow && crossesBlocks()) {
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
                e.preventDefault();
                const range = sel.getRangeAt(0);
                const toStart = e.key === 'ArrowUp' || e.key === 'ArrowLeft';
                const node = toStart ? range.startContainer : range.endContainer;
                const offset = toStart ? range.startOffset : range.endOffset;
                blockElementOf(node)?.focus({preventScroll: true});
                sel.collapse(node, offset);
            }
            return;
        }

        if (e.key === 'ArrowUp' && !e.shiftKey && !mod) {
            if (caretOnFirstLine(el)) {
                e.preventDefault();
                const x = caretLineRect(el).left;
                const prev = findEditableSibling(id, -1);
                if (prev) focusNavigableVertical(prev, x, 'bottom');
                else focusTitleEnd();
            }
            return;
        }

        if (e.key === 'ArrowDown' && !e.shiftKey && !mod) {
            if (caretOnLastLine(el)) {
                const next = findEditableSibling(id, 1);
                if (next) {
                    e.preventDefault();
                    focusNavigableVertical(next, caretLineRect(el).left, 'top');
                }
            }
            return;
        }

        if (e.key === 'ArrowLeft' && !e.shiftKey && !mod) {
            const sel = window.getSelection();
            if (sel?.isCollapsed && caretAtStart(el)) {
                e.preventDefault();
                const prev = findEditableSibling(id, -1);
                if (prev) focusNavigableBlock(prev, 'end');
                else focusTitleEnd();
            }
            return;
        }

        if (e.key === 'ArrowRight' && !e.shiftKey && !mod) {
            const sel = window.getSelection();
            if (sel?.isCollapsed && caretAtEnd(el)) {
                const next = findEditableSibling(id, 1);
                if (next) {
                    e.preventDefault();
                    focusNavigableBlock(next, 'start');
                }
            }
            return;
        }

        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            el.blur();
            selectSingleBlock(id);
        }
    };

    // ----- wiki links -----

    /**
     * The `[[target]]` the caret (or a click) sits inside, or null.
     *
     * Wiki links are stored as literal text — the same bytes Obsidian writes — rather than as markup,
     * so they survive every edit path untouched and need no DOM transform. That means following one
     * is a text-and-offset lookup rather than a click on an anchor.
     */
    const wikiLinkRangeAt = (
        text: string,
        offset: number,
    ): {start: number; end: number; inner: string; target: string} | null => {
        for (const match of text.matchAll(/\[\[([^[\]\n]+)\]\]/g)) {
            const start = match.index ?? 0;
            const end = start + match[0].length;
            if (offset >= start && offset <= end) {
                // `|alias` and `#heading` are display/anchor sugar; the note is named by what
                // precedes them. Read through wikiLinks.ts so this surface and the resolver can
                // never disagree about what a target means.
                const target = normalizeTarget(match[1]);
                return target ? {start, end, inner: match[1], target} : null;
            }
        }
        return null;
    };

    const wikiLinkAt = (text: string, offset: number): string | null =>
        wikiLinkRangeAt(text, offset)?.target ?? null;

    const followWikiLink = (id: string, offset: number): boolean => {
        if (!onWikiLinkNavigate) return false;
        const el = refs.current.get(id);
        if (!el) return false;
        const target = wikiLinkAt(el.textContent ?? '', offset);
        if (!target) return false;
        onWikiLinkNavigate(target);
        return true;
    };

    /**
     * Paint a selection that crosses blocks ourselves. Each block is its own contentEditable, and
     * WebKit draws only the part of such a selection inside the block that has focus — ⇧↓ moved the
     * selection on but showed it stopping at the end of the line. The CSS Custom Highlight API
     * paints the real range in every engine, and the native highlight is hidden meanwhile so
     * Chromium doesn't draw it twice.
     */
    useEffect(() => {
        if (
            typeof CSS === 'undefined' ||
            !('highlights' in CSS) ||
            typeof Highlight === 'undefined'
        )
            return undefined;
        // The blocks the highlight last covered. WebKit doesn't always repaint them when a
        // highlight goes away, leaving part of the old selection on screen, so they get a one-frame
        // nudge that forces it.
        let painted: HTMLElement[] = [];
        const repaint = (blocks: HTMLElement[]) => {
            for (const block of blocks) block.style.opacity = '0.999';
            requestAnimationFrame(() => {
                for (const block of blocks) block.style.removeProperty('opacity');
            });
        };
        const update = () => {
            const root = rootRef.current;
            const selection = window.getSelection();
            const crossing = Boolean(
                root &&
                selection &&
                selection.rangeCount > 0 &&
                root.contains(selection.anchorNode) &&
                crossesBlocks(),
            );
            root?.classList.toggle(CROSS_SELECTION_CLASS, crossing);
            if (crossing && root && selection) {
                const parts = perBlockRanges(root, selection.getRangeAt(0));
                const next = parts.map((part) => part.block);
                // Every block the highlight covered or covers: one that keeps a smaller part of it
                // can leave the dropped part painted, just as one that leaves it can.
                repaint([...new Set([...painted, ...next])]);
                painted = next;
                CSS.highlights.set(
                    CROSS_SELECTION_HIGHLIGHT,
                    new Highlight(...parts.map((part) => part.range)),
                );
            } else if (painted.length > 0) {
                CSS.highlights.delete(CROSS_SELECTION_HIGHLIGHT);
                repaint(painted);
                painted = [];
            }
        };
        const unsubscribe = subscribeSelectionFrame(update);
        return () => {
            unsubscribe();
            CSS.highlights.delete(CROSS_SELECTION_HIGHLIGHT);
        };
        // `crossesBlocks` reads only the live selection and DOM.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /**
     * Track the caret into and out of a link. `selectionchange` is the only event that fires for
     * every way the caret can get there — typing, arrows, a click, a drag — and the rect comes from
     * the DECORATION span (wikiDecorate.ts), which is the on-screen extent of the link.
     */
    useEffect(() => {
        const update = () => {
            // While the popup's own text field has focus, the caret is in it, not in the note.
            if (tipEditRef.current !== null) return;
            // A click on a link chip puts the caret inside it, where no caret can live.
            if (rootRef.current) moveCaretOutOfAtom(rootRef.current);
            const selection = window.getSelection();
            const node = selection?.anchorNode;
            const element = node instanceof Element ? node : node?.parentElement;
            const bareUrl = element?.closest<HTMLElement>(`.${URL_LINK_CLASS}`);
            const anchor = bareUrl ?? element?.closest('a');
            const href = bareUrl ? bareUrl.textContent : anchor?.getAttribute('href');
            if (
                anchor &&
                href &&
                selection?.isCollapsed &&
                rootRef.current?.contains(anchor) &&
                anchor.closest('[contenteditable="true"]')
            ) {
                const rect = anchor.getBoundingClientRect();
                setAnchorTip((current) =>
                    current?.anchor === anchor && current.href === href
                        ? current
                        : {anchor, href, x: rect.left, y: rect.bottom + 6},
                );
            } else {
                setAnchorTip((current) => (current ? null : current));
            }
            // The chip is atomic, so the caret sits against it rather than in it.
            const span = node ? wikiLinkTouching(node, selection.anchorOffset) : null;
            const content = span?.closest<HTMLElement>('[data-block-id]');
            const blockId = content?.dataset.blockId;
            if (!span || !blockId || !selection?.isCollapsed || !rootRef.current?.contains(span)) {
                setLinkTip((current) => (current ? null : current));
                return;
            }
            const probe = document.createRange();
            probe.selectNodeContents(content);
            probe.setEnd(span, 0);
            const range = wikiLinkRangeAt(content.textContent ?? '', probe.toString().length);
            if (!range) {
                setLinkTip((current) => (current ? null : current));
                return;
            }
            const rect = span.getBoundingClientRect();
            setLinkTip((current) =>
                current?.blockId === blockId && current.start === range.start
                    ? current
                    : {blockId, ...range, x: rect.left, y: rect.bottom + 6, top: rect.top},
            );
        };
        return subscribeSelectionFrame(update);
    }, []);

    const returnToLink = (tip: {blockId: string; end: number}) => {
        const el = refs.current.get(tip.blockId);
        if (!el) return;
        el.focus({preventScroll: true});
        setCaret(el, tip.end);
    };

    const repointLink = (tip: NonNullable<typeof linkTip>, item: WikiSuggestItem) => {
        const {alias} = splitWikiTarget(tip.inner);
        const target = linkTargetFor(item);
        setTipEdit(null);
        replaceWikiLink(tip, alias ? `[[${target}|${alias}]]` : `[[${target}]]`);
    };

    /** Replace the link's whole `[[…]]` run with `replacement`, leaving the caret after it. */
    const replaceWikiLink = (tip: NonNullable<typeof linkTip>, replacement: string) => {
        const el = refs.current.get(tip.blockId);
        if (!el) return;
        setLinkTip(null);
        // Re-validate against the LIVE text: the tooltip may have been on screen while the block
        // changed under it, and splicing a stale range would cut the wrong characters.
        const live = wikiLinkRangeAt(el.textContent ?? '', tip.start);
        if (!live || live.start !== tip.start || live.inner !== tip.inner) return;
        // The popup's own field may have focus; the edit below types into whatever does.
        el.focus({preventScroll: true});
        deleteTextRange(el, live.start, live.end);
        if (el.innerHTML === '<br>') el.innerHTML = '';
        if (replacement) insertPlainTextAtCaret(replacement);
        commitHtml(tip.blockId, el);
    };

    const onContentMouseDown = (e: MouseEvent<HTMLDivElement>, id: string) => {
        if (!(e.metaKey || e.ctrlKey)) return;
        const el = refs.current.get(id);
        if (!el) return;
        // caretRangeFromPoint gives the character the pointer is over, which is what decides whether
        // the ⌘-click landed on a link.
        const range = document.caretRangeFromPoint?.(e.clientX, e.clientY);
        if (!range) return;
        const probe = document.createRange();
        probe.selectNodeContents(el);
        try {
            probe.setEnd(range.startContainer, range.startOffset);
        } catch {
            return;
        }
        if (followWikiLink(id, probe.toString().length)) e.preventDefault();
    };

    // ----- external links -----

    /**
     * A click on a real `<a href>` anywhere in the body.
     *
     * Nothing used to handle it, so the click fell through to the webview's default: following a
     * link REPLACES the app's own document with the target site — in the desktop shell that
     * destroys the window (no back button, no shell left to restore it). So the default is always
     * cancelled, even for a destination we won't open.
     *
     * Which links actually open, and how, is `openExternalUrl`'s business — the app-wide choke
     * point that hands the URL to the OS browser on the desktop / a new tab on the web, and refuses
     * anything outside http/https/mailto/tel. `anchor.href` is the browser-resolved absolute form,
     * so a note-relative `docs/spec.md` arrives as the app's own origin and is simply dropped.
     *
     * ⌘/Ctrl-click is the trigger, matching the Gravity engine (and this surface's own ⌘-click for
     * `[[wiki links]]`, handled earlier in `onContentMouseDown` — a wiki link is literal text, not
     * an anchor, so the two never contend). A plain click stays an edit gesture: it places the
     * caret in the link text.
     */
    const onRootClick = (e: MouseEvent<HTMLDivElement>) => {
        const bareUrl = (e.target as HTMLElement | null)?.closest(`.${URL_LINK_CLASS}`);
        if (bareUrl && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            openExternalUrl(bareUrl.textContent ?? '');
            return;
        }
        const anchor = (e.target as HTMLElement | null)?.closest('a');
        const href = anchor?.getAttribute('href');
        if (!href) return;
        e.preventDefault();
        if (!(e.metaKey || e.ctrlKey)) return;
        openHref(href);
    };

    const openHref = (href: string) => {
        // An attachment is a file in the workspace, not a URL: `anchor.href` has already resolved it
        // against the app's own origin, so only the RAW attribute still names the file. The host
        // knows what to do with it (reveal it in Finder); `openExternalUrl` would simply drop it.
        if (isAttachmentRef(href)) {
            try {
                onOpenAttachment?.(decodeURI(href));
            } catch {
                showToast('Could not open the attachment link');
            }
        } else openExternalUrl(href);
    };

    /** Select the whole link a tip is for, so the link box or `unlink` acts on all of it. */
    const selectAnchor = (anchor: HTMLElement): boolean => {
        if (!anchor.isConnected) return false;
        const range = document.createRange();
        range.selectNodeContents(anchor);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return true;
    };

    const unlinkAnchor = (anchor: HTMLElement) => {
        const host = anchor.closest<HTMLElement>('[data-block-id]');
        if (!host || !selectAnchor(anchor)) return;
        document.execCommand('unlink');
        window.getSelection()?.collapseToEnd();
        const {tableBlockId, tableRow, tableColumn, blockId} = host.dataset;
        if (tableBlockId) {
            updateTableCell(tableBlockId, Number(tableRow), Number(tableColumn), host.innerHTML);
        } else if (blockId) {
            commitHtml(blockId, host);
        }
    };

    // Mirror the live modifier state onto the root so links can show they're clickable before the
    // user commits. Listening on the document (capture) tracks it even while the pointer, not the
    // keyboard, is what has focus; the window blur covers ⌘-tabbing away, which fires no keyup.
    useEffect(() => {
        const root = rootRef.current;
        if (!root) return undefined;
        const sync = (event: globalThis.KeyboardEvent) => {
            root.classList.toggle(MOD_PRESSED_CLASS, event.metaKey || event.ctrlKey);
        };
        const clear = () => root.classList.remove(MOD_PRESSED_CLASS);
        document.addEventListener('keydown', sync, true);
        document.addEventListener('keyup', sync, true);
        window.addEventListener('blur', clear);
        return () => {
            document.removeEventListener('keydown', sync, true);
            document.removeEventListener('keyup', sync, true);
            window.removeEventListener('blur', clear);
        };
    }, []);

    // A key pressed in the editor means the hand left the mouse: the block under the resting pointer
    // drops its hover handle until the pointer actually moves again (a re-layout under a still
    // pointer can fire `mousemove` at the same coordinates, so those don't count).
    useEffect(() => {
        const root = rootRef.current;
        if (!root) return undefined;
        let last: {x: number; y: number} | null = null;
        const onKeyDown = (event: globalThis.KeyboardEvent) => {
            if (MODIFIER_KEYS.has(event.key)) return;
            if (event.target instanceof Node && root.contains(event.target)) {
                root.classList.add(KEYBOARD_CLASS);
            }
        };
        const onMouseMove = (event: globalThis.MouseEvent) => {
            const moved = !last || last.x !== event.clientX || last.y !== event.clientY;
            last = {x: event.clientX, y: event.clientY};
            if (moved) root.classList.remove(KEYBOARD_CLASS);
        };
        document.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('mousemove', onMouseMove, true);
        return () => {
            document.removeEventListener('keydown', onKeyDown, true);
            document.removeEventListener('mousemove', onMouseMove, true);
        };
    }, []);

    // ----- input handling -----

    const onInput = (id: string) => {
        const el = refs.current.get(id);
        const block = findBlock(id);
        if (!el || !block) return;
        if (composingRef.current) return;
        if (el.innerHTML === '<br>') el.innerHTML = '';

        const pending = pendingSlash.current;
        if (pending && pending.blockId === id) {
            pendingSlash.current = null;
            if ((el.textContent ?? '')[pending.anchor] === '/') {
                openSlashMenu(id, pending.anchor, 1);
            }
        } else if (wikiRef.current && wikiRef.current.blockId === id) {
            syncWikiMenu(wikiRef.current, el);
        } else if (slashRef.current && slashRef.current.blockId === id) {
            const s = slashRef.current;
            const text = el.textContent ?? '';
            const offset = getCaretOffset(el);
            if ((s.slashLen === 1 && text[s.anchor] !== '/') || offset < s.anchor + s.slashLen) {
                setSlash(null);
            } else {
                const query = text.slice(s.anchor + s.slashLen, offset);
                if (query !== s.query) {
                    if (query.endsWith(' ') && filterMenuItems(query).length === 0) {
                        setSlash(null);
                    } else {
                        setSlash({...s, query});
                        setSlashIndex(0);
                    }
                }
            }
        } else if (block.type !== 'code') {
            tryInlineMarkdown(el);
            // `[[` opens the note picker. Checked after the inline-Markdown pass (which can rewrite
            // the run the caret sits in) and never inside code, where brackets are content.
            const caret = getCaretOffset(el);
            if (caret >= 2 && (el.textContent ?? '').slice(caret - 2, caret) === '[[') {
                openWikiMenu(id, caret - 2);
            }
        }

        const text = (el.textContent ?? '').replace(/\u200B/g, '');
        if (block.type === 'text' && !slashRef.current && !pendingSlash.current) {
            if (text === '---') {
                const nb = newBlock('text');
                const idx = indexOf(id);
                setBlocks((bs) => {
                    const arr = bs.map((b) =>
                        b.id === id
                            ? {...b, type: 'divider' as BlockType, html: '', collapsed: undefined}
                            : b,
                    );
                    arr.splice(idx + 1, 0, nb);
                    return arr;
                });
                focusReq.current = {id: nb.id, pos: 'start'};
                return;
            }
            if (text === '```') {
                el.innerHTML = '';
                setBlocks((bs) =>
                    bs.map((b) =>
                        b.id === id
                            ? {...b, type: 'code' as BlockType, html: '', collapsed: undefined}
                            : b,
                    ),
                );
                focusReq.current = {id, pos: 'start'};
                return;
            }
        }

        commitHtml(id, el);
    };

    /**
     * Store dropped/pasted images in the workspace's `Attachments/` folder and drop image blocks in
     * after `afterId`. The note only ever carries the returned root-relative reference, so a note can
     * move between folders without its images breaking.
     */
    const insertBlocksAfter = (afterId: string, inserted: BlockData[]) => {
        if (!inserted.length) return;
        setBlocks((current) => {
            const at = current.findIndex((candidate) => candidate.id === afterId);
            const next = [...current];
            // The anchor can be gone by now — `onAttachFile` is awaited by both callers, and the
            // block may have been merged or deleted while the bytes were being written. `findIndex`
            // returns -1 then, and `splice(-1 + 1, …)` would silently insert at the TOP of the note.
            if (at === -1) {
                next.push(...inserted);
                return next;
            }
            // An empty paragraph is replaced rather than left dangling above what arrived.
            const target = current[at];
            if (target && target.type === 'text' && isEmptyHtml(target.html))
                next.splice(at, 1, ...inserted);
            else next.splice(at + 1, 0, ...inserted);
            return next;
        });
    };

    const insertAttachmentFiles = async (afterId: string, files: File[], apply = true) => {
        if (!onAttachFile) return [];
        const inserted: BlockData[] = [];
        for (const file of files) {
            const ref = await onAttachFile(file);
            if (!ref) continue;
            const block = newBlock(
                'text',
                `<a href="${escapeHtml(encodeURI(ref))}" rel="noopener noreferrer">${escapeHtml(
                    file.name,
                )}</a>`,
            );
            block.depth = findBlock(afterId)?.depth ?? 0;
            inserted.push(block);
        }
        if (apply) insertBlocksAfter(afterId, inserted);
        return inserted;
    };

    const insertImageFiles = async (afterId: string, files: File[], apply = true) => {
        if (!onAttachFile) return [];
        const inserted: BlockData[] = [];
        for (const file of files) {
            const ref = await onAttachFile(file);
            if (!ref) continue;
            const image = newBlock('image');
            image.image = {src: ref, alt: file.name.replace(/\.[^.]+$/, '')};
            image.depth = findBlock(afterId)?.depth ?? 0;
            inserted.push(image);
        }
        if (apply) insertBlocksAfter(afterId, inserted);
        return inserted;
    };

    const imageFilesFrom = (list: FileList | null | undefined): File[] =>
        [...(list ?? [])].filter((file) => file.type.startsWith('image/'));

    /**
     * Anything else that was dropped or pasted. An image becomes an image block; everything else
     * becomes an ordinary Markdown link to the stored file — the portable spelling, which Obsidian
     * and GitHub both render, rather than a block type only this app would understand.
     */
    const otherFilesFrom = (list: FileList | null | undefined): File[] =>
        [...(list ?? [])].filter((file) => !file.type.startsWith('image/') && file.size > 0);

    /**
     * Cheap "does the selection leave the block it started in?" — two `closest()` walks, so it can
     * sit on the keystroke path that {@link selectionBlockIds} (an O(blocks) DOM scan) cannot.
     * A table cell reports its TABLE's id, since that is the block either one belongs to.
     */
    const selectionCrossesBlocks = () => crossesBlocks() && selectionBlockIds().length > 1;

    const crossesBlocks = (): boolean => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
        const owner = (node: Node | null): string | null => {
            const el = blockElementOf(node);
            return el ? (el.dataset.tableBlockId ?? el.dataset.blockId ?? null) : null;
        };
        const anchor = owner(selection.anchorNode);
        const focus = owner(selection.focusNode);
        // A focus that left every block — dragged on into the backlinks panel below — counts as
        // crossing too: the partial path would `deleteFromDocument` across that boundary as well.
        // Being generous is free, since the caller still acts only when the scan finds >1 block.
        return (anchor !== null || focus !== null) && anchor !== focus;
    };

    /**
     * The blocks a native text selection really covers, in document order. Each block is its own
     * contentEditable, but a mouse drag extends ONE document selection across them, so this is
     * routinely more than the block the event fired on.
     */
    const selectionBlockIds = (): string[] => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return [];
        const range = selection.getRangeAt(0);
        const wrappers = new Map<string, HTMLElement>();
        for (const el of rootRef.current?.querySelectorAll<HTMLElement>('.block') ?? [])
            wrappers.set(el.id, el);

        // The blocks holding the ends count even where the range covers none of their text: a
        // selection that stops at a block boundary still takes the break, as in a text editor.
        const ownerOf = (node: Node) => {
            const el = blockElementOf(node);
            return el?.dataset.tableBlockId ?? el?.dataset.blockId;
        };
        const ends = new Set([ownerOf(range.startContainer), ownerOf(range.endContainer)]);
        const blocks = blocksRef.current;
        let first = -1;
        let last = -1;
        for (let index = 0; index < blocks.length; index++) {
            // Editable blocks are measured on their CONTENT element — the wrapper also holds the
            // list marker, which a range that merely stops at the block's first character would
            // still cover, pulling in a block the user selected nothing in. A table is measured on
            // its grid, since the wrapper also holds the toolbar and add buttons, whose labels are
            // text a drag can brush. Images have no content element, so the wrapper is all there is.
            const wrapper = wrappers.get(blocks[index].id);
            const el =
                refs.current.get(blocks[index].id) ??
                wrapper?.querySelector<HTMLElement>('.simple-table') ??
                wrapper;
            if (!el || (!ends.has(blocks[index].id) && rangeTextWithin(el, range) === '')) continue;
            if (first < 0) first = index;
            last = index;
        }
        if (first < 0) return [];
        // Everything BETWEEN the ends comes too, whether or not it holds text: a divider, an
        // uncaptioned image or an empty paragraph contributes nothing for the range to cover, and
        // leaving them behind meant a drag across three blocks deleted two and left the rule in
        // the middle sitting on its own.
        return blocks.slice(first, last + 1).map((block) => block.id);
    };

    /**
     * A text selection across blocks, split where it starts and ends: the first block's text before
     * it (`head`) and selected part, the last block's selected part and text after it (`tail`).
     * Null when an end is not a text block — an image, a table cell, a toggle hiding children —
     * where an edit takes the blocks whole, as a block selection would.
     */
    const textSelectionAcross = (spanned: string[]) => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || spanned.length < 2) return null;
        const range = selection.getRangeAt(0);
        const first = findBlock(spanned[0]);
        const last = findBlock(spanned[spanned.length - 1]);
        const firstEl = first ? refs.current.get(first.id) : undefined;
        const lastEl = last ? refs.current.get(last.id) : undefined;
        if (!first || !last || !firstEl || !lastEl) return null;
        if (!isEditableType(first.type) || !isEditableType(last.type)) return null;
        if ((first.type === 'code') !== (last.type === 'code')) return null;
        const bs = blocksRef.current;
        const visible = visibleBlockIds(bs);
        const after = bs[indexOf(last.id) + 1];
        if (after && (after.depth ?? 0) > (last.depth ?? 0) && !visible.has(after.id)) return null;
        type Point = [Node, number];
        const slice = (el: HTMLElement, from: Point | null, to: Point | null) => {
            const part = document.createRange();
            part.selectNodeContents(el);
            if (from) part.setStart(...from);
            if (to) part.setEnd(...to);
            const holder = document.createElement('div');
            holder.appendChild(part.cloneContents());
            return {html: stripZeroWidth(holder.innerHTML), length: part.toString().length};
        };
        const start: Point | null = firstEl.contains(range.startContainer)
            ? [range.startContainer, range.startOffset]
            : null;
        const end: Point | null = lastEl.contains(range.endContainer)
            ? [range.endContainer, range.endOffset]
            : null;
        const none = {html: '', length: 0};
        return {
            first,
            last,
            firstEl,
            // Only what the reader can see: a collapsed toggle at the START keeps its hidden
            // children under the joined line, as Backspace's merge does. A collapsed toggle in the
            // middle still goes whole — `blocksInScope` re-adds its hidden children.
            middle: spanned.slice(1, -1).filter((id) => visible.has(id)),
            head: start ? slice(firstEl, null, start) : none,
            firstPart: slice(firstEl, start, null),
            lastPart: slice(lastEl, null, end),
            tail: end ? slice(lastEl, end, null) : none,
        };
    };

    /**
     * Delete a cross-block text selection the way a text editor does: the first block keeps its
     * head, gains the last block's tail (plus `insert`, typed or pasted text, between them), and
     * everything selected in between goes. Done to the DOM at once, so a paste can carry on
     * inside the merged block; returns that block's element.
     */
    const deleteAcross = (
        ends: NonNullable<ReturnType<typeof textSelectionAcross>>,
        insert = '',
        mode: ChangeMode = 'structural',
    ): HTMLElement => {
        const {first, last, firstEl, head, tail} = ends;
        const merged = decorateRef.current(
            oneLineIfHeading(first.type, head.html + escapeHtml(insert) + tail.html),
            first.type,
        );
        const removed = blocksInScope([...ends.middle, last.id], 'exact');
        firstEl.innerHTML = merged;
        firstEl.focus({preventScroll: true});
        setCaret(firstEl, head.length + insert.length);
        setBlocks(
            (bs) =>
                normalizeDepths(
                    bs
                        .filter((b) => !removed.has(b.id))
                        .map((b) => (b.id === first.id ? {...b, html: merged} : b)),
                ),
            mode,
            first.id,
        );
        return firstEl;
    };

    /** Enter over a cross-block selection: the selection goes, the head and tail stay apart. */
    const splitAcross = (ends: NonNullable<ReturnType<typeof textSelectionAcross>>) => {
        const {first, last, head, tail} = ends;
        const removed = blocksInScope(ends.middle, 'exact');
        setBlocks((bs) =>
            normalizeDepths(
                bs
                    .filter((b) => !removed.has(b.id))
                    .map((b) =>
                        b.id === first.id
                            ? {...b, html: head.html}
                            : b.id === last.id
                              ? {...b, html: tail.html}
                              : b,
                    ),
            ),
        );
        window.getSelection()?.removeAllRanges();
        focusReq.current = {id: last.id, pos: 'start'};
    };

    /**
     * Copy/cut of a selection INSIDE a block, as Markdown.
     *
     * The browser's own `text/plain` is the RENDERED text, so copying `**bold**` out of a Markdown
     * app yielded `bold`. Block-level copy already wrote Markdown (see `onSelectionClipboard`);
     * this is the in-block half.
     */
    const onCopyCut = (e: ClipboardEvent<HTMLDivElement>, id: string) => {
        // Across blocks this becomes a WHOLE-BLOCK operation, the same one the block-selection
        // clipboard handler performs — which is both what Notion does and the only safe answer
        // here. The partial path below cannot serve it: `deleteFromDocument` would rip nodes out of
        // the OTHER blocks' React-owned DOM while only this one's state was committed, so the cut
        // text came straight back on the next render (and left React reconciling against children
        // that no longer existed).
        //
        // `crossesBlocks` gates the scan: `selectionBlockIds` walks every block in the note, and a
        // plain ⌘C inside one paragraph must not pay that on a long note.
        if (crossesBlocks()) {
            const spanned = selectionBlockIds();
            if (spanned.length > 1) {
                e.preventDefault();
                const ends = textSelectionAcross(spanned);
                if (!ends) {
                    writeBlocksToClipboard(e.clipboardData, spanned, e.type === 'cut', 'exact');
                    return;
                }
                const middle = blocksInScope(ends.middle, 'exact');
                writeClipboardBlocks(e.clipboardData, [
                    {...ends.first, html: ends.firstPart.html},
                    ...blocksRef.current.filter((b) => middle.has(b.id)),
                    {...ends.last, html: ends.lastPart.html},
                ]);
                if (e.type === 'cut') deleteAcross(ends);
                return;
            }
        }

        const html = selectionHtml();
        if (!html) return; // nothing selected — let the browser do its thing
        e.preventDefault();
        e.clipboardData.setData('text/plain', inlineHtmlToMarkdown(html));
        if (e.type !== 'cut') return;
        const el = refs.current.get(id);
        if (!el) return;
        window.getSelection()?.deleteFromDocument();
        commitHtml(id, el);
    };

    const replaceWithMarkdown = (ids: string[], text: string) => {
        if (hasUnsupportedMarkdown(text)) {
            showToast('This Markdown needs source mode. Switch to source to paste it safely.');
            return;
        }
        replaceWithBlocks(ids, normalizeParsedBlocks(markdownToBlocks(text)));
    };

    const replaceWithBlocks = (ids: string[], incoming: BlockData[]) => {
        const index = indexOf(ids[0]);
        if (index < 0) return;
        const depth = blocksRef.current[index].depth ?? 0;
        const pasted = incoming.map((block) => decorateBlock(block, decorateRef.current));
        if (pasted.some((item) => (item.depth ?? 0) + depth > MAX_BLOCK_DEPTH)) {
            showToast('This paste is too deeply nested. Use source mode to keep its structure.');
            return;
        }
        for (const item of pasted) item.depth = (item.depth ?? 0) + depth;
        pasted[0].id = ids[0];
        const removed = new Set(ids);
        setBlocks((current) => {
            const next = current.filter((item) => !removed.has(item.id));
            next.splice(index, 0, ...pasted);
            return normalizeDepths(next);
        });
        window.getSelection()?.removeAllRanges();
        const visible = visibleBlockIds(pasted);
        const last = [...pasted]
            .reverse()
            .find(
                (item) =>
                    visible.has(item.id) && (isEditableType(item.type) || item.type === 'table'),
            );
        if (last) focusReq.current = caretTargetIn(last, 'end');
        else selectSingleBlock(pasted[pasted.length - 1].id);
    };

    const commitAcrossPaste = (
        ends: NonNullable<ReturnType<typeof textSelectionAcross>>,
        first: BlockData,
        rest: BlockData[],
        caret: {id: string; pos: CaretPos},
    ) => {
        const removed = blocksInScope([...ends.middle, ends.last.id], 'exact');
        const hiddenChildren = new Set(
            ends.first.collapsed
                ? blocksRef.current
                      .slice(
                          indexOf(ends.first.id) + 1,
                          afterSubtree(blocksRef.current, indexOf(ends.first.id)),
                      )
                      .map((block) => block.id)
                : [],
        );
        setBlocks((current) => {
            const next = current
                .filter((block) => !removed.has(block.id))
                .map((block) => (block.id === first.id ? first : block));
            let at = next.findIndex((block) => block.id === first.id) + 1;
            while (at < next.length && hiddenChildren.has(next[at].id)) at++;
            next.splice(at, 0, ...rest);
            return normalizeDepths(next);
        });
        window.getSelection()?.removeAllRanges();
        focusReq.current = caret;
    };

    const pasteInlineAcross = (
        ends: NonNullable<ReturnType<typeof textSelectionAcross>>,
        html: string,
    ) => {
        const first = {
            ...ends.first,
            html: decorateRef.current(
                oneLineIfHeading(ends.first.type, ends.head.html + html + ends.tail.html),
                ends.first.type,
            ),
        };
        commitAcrossPaste(ends, first, [], {
            id: first.id,
            pos: ends.head.length + htmlToText(html).length,
        });
    };

    const pasteBlocksAcross = (
        ends: NonNullable<ReturnType<typeof textSelectionAcross>>,
        incoming: BlockData[],
        text: string,
        kind: 'internal' | 'rich' | 'markdown',
    ) => {
        const depth = ends.first.depth ?? 0;
        const pasted: BlockData[] = incoming.map((block) => ({
            ...decorateBlock(block, decorateRef.current),
            depth: depth + (block.depth ?? 0),
        }));
        if (pasted.some((block) => (block.depth ?? 0) > MAX_BLOCK_DEPTH)) {
            showToast('This paste is too deeply nested. Use source mode to keep its structure.');
            return;
        }
        let first = {...ends.first, html: ends.head.html};
        let rest = pasted;
        let caret: {id: string; pos: CaretPos};
        if (kind === 'internal') {
            if (isEmptyHtml(first.html) && !first.collapsed) {
                first = {...pasted[0], id: first.id, depth};
                rest = pasted.slice(1);
            } else if (
                first.type === 'text' &&
                pasted[0].type === 'text' &&
                pasted[0].depth === depth
            ) {
                first.html += pasted[0].html;
                rest = pasted.slice(1);
            }
            const visible = visibleBlockIds([first, ...rest]);
            const last = [first, ...rest]
                .reverse()
                .find(
                    (block) =>
                        visible.has(block.id) &&
                        (isEditableType(block.type) || block.type === 'table'),
                );
            caret = last ? caretTargetIn(last, 'end') : {id: first.id, pos: 'end'};
            if (ends.tail.html) {
                const tailHost = rest[rest.length - 1] ?? first;
                if (
                    visible.has(tailHost.id) &&
                    tailHost.depth === depth &&
                    tailHost.type === 'text' &&
                    ends.last.type === 'text'
                ) {
                    caret = {id: tailHost.id, pos: htmlToText(tailHost.html).length};
                    if (tailHost === first) first.html += ends.tail.html;
                    else
                        rest = [
                            ...rest.slice(0, -1),
                            {...tailHost, html: tailHost.html + ends.tail.html},
                        ];
                } else rest = [...rest, {...ends.last, html: ends.tail.html, depth}];
            }
        } else if (first.type === 'text' && isEmptyHtml(ends.head.html + ends.tail.html)) {
            first = {...pasted[0], id: first.id};
            rest = pasted.slice(1);
            const visible = visibleBlockIds([first, ...rest]);
            const last = [first, ...rest]
                .reverse()
                .find(
                    (block) =>
                        visible.has(block.id) &&
                        (isEditableType(block.type) || block.type === 'table'),
                );
            caret = last ? caretTargetIn(last, 'end') : {id: first.id, pos: 'end'};
        } else {
            const lead = kind === 'rich' && /^\s/.test(text) && ends.head.html ? ' ' : '';
            const trail = kind === 'rich' && /\s$/.test(text) && ends.tail.html ? ' ' : '';
            if (kind === 'markdown') {
                const lines = text.split('\n');
                first.html += oneLineIfHeading(first.type, escapeHtml(lines.shift() ?? ''));
                rest = normalizeParsedBlocks(markdownToBlocks(lines.join('\n'))).map((block) => ({
                    ...decorateBlock(block, decorateRef.current),
                    depth: depth + (block.depth ?? 0),
                }));
            } else if (pasted[0].type === 'text' && pasted[0].depth === depth) {
                first.html += lead + oneLineIfHeading(first.type, pasted[0].html);
                rest = pasted.slice(1);
            }
            const last = rest[rest.length - 1];
            const visible = visibleBlockIds([first, ...rest]);
            caret = {id: first.id, pos: htmlToText(first.html).length};
            if (!last) first.html += trail + ends.tail.html;
            else if (visible.has(last.id) && isEditableType(last.type)) {
                caret = {id: last.id, pos: htmlToText(last.html).length};
                rest = [...rest.slice(0, -1), {...last, html: last.html + trail + ends.tail.html}];
            } else if (ends.tail.html) {
                const suffix = {...newBlock('text', ends.tail.html), depth};
                rest = [...rest, suffix];
                caret = {id: suffix.id, pos: 'start'};
            } else if (last.type === 'table') caret = caretTargetIn(last, 'end');
        }
        first = decorateBlock(first, decorateRef.current);
        commitAcrossPaste(ends, first, rest, caret);
    };

    const onPaste = (e: ClipboardEvent<HTMLDivElement>, id: string): void => {
        e.preventDefault();
        const replaced = crossesBlocks() ? selectionBlockIds() : [];
        const ends = textSelectionAcross(replaced);
        if (ends) id = ends.first.id;
        const el = refs.current.get(id);
        const block = findBlock(id);
        if (!el || !block) return;
        const images = imageFilesFrom(e.clipboardData.files);
        const others = otherFilesFrom(e.clipboardData.files);
        if ((images.length || others.length) && onAttachFile) {
            if (ends) {
                const before = blocksRef.current;
                void Promise.all([
                    insertImageFiles(id, images, false),
                    insertAttachmentFiles(id, others, false),
                ])
                    .then((groups) => {
                        const inserted = groups.flat();
                        if (!inserted.length || hiddenRef.current) return;
                        if (blocksRef.current !== before) insertBlocksAfter(id, inserted);
                        else
                            pasteBlocksAcross(
                                ends,
                                inserted.map((item) => ({...item, depth: 0})),
                                '',
                                'internal',
                            );
                    })
                    .catch(() => showToast('Could not attach file'));
                return;
            }
            if (images.length) void insertImageFiles(id, images);
            if (others.length) void insertAttachmentFiles(id, others);
            return;
        }
        const serializedBlocks = e.clipboardData.getData('application/x-notion-editor-blocks');
        if (serializedBlocks) {
            try {
                const parsed = JSON.parse(serializedBlocks) as BlockData[];
                if (Array.isArray(parsed) && parsed.length > 0) {
                    const valid = normalizeParsedBlocks(
                        parsed.filter(
                            (item) =>
                                item &&
                                BLOCK_TYPE_SET.has(item.type) &&
                                typeof item.html === 'string',
                        ),
                    );
                    // The copied blocks carry the depths they had where they were copied from;
                    // they land relative to the host instead.
                    const shallowest = Math.min(...valid.map((item) => item.depth ?? 0));
                    const pasted = valid.map((item) =>
                        decorateBlock(
                            {
                                ...item,
                                id: uid(),
                                depth: (item.depth ?? 0) - shallowest,
                            },
                            decorateRef.current,
                        ),
                    );
                    if (pasted.length) {
                        if (ends) {
                            pasteBlocksAcross(ends, pasted, '', 'internal');
                            return;
                        }
                        for (const item of pasted) {
                            item.depth = Math.min(
                                MAX_BLOCK_DEPTH,
                                (block.depth ?? 0) + (item.depth ?? 0),
                            );
                        }
                        const idx = indexOf(id);
                        let lastInserted = pasted[pasted.length - 1];
                        if (isEmptyHtml(el.innerHTML)) {
                            const first = {...pasted.shift()!, id, depth: block.depth ?? 0};
                            lastInserted = pasted[pasted.length - 1] ?? first;
                            setBlocks((bs) => {
                                const arr = bs.map((candidate) =>
                                    candidate.id === id ? first : candidate,
                                );
                                arr.splice(afterSubtree(arr, idx), 0, ...pasted);
                                return normalizeDepths(arr);
                            });
                        } else {
                            // After the host's own children, which stay the host's.
                            setBlocks((bs) => {
                                const arr = [...bs];
                                arr.splice(afterSubtree(arr, idx), 0, ...pasted);
                                return normalizeDepths(arr);
                            });
                        }
                        if (lastInserted.type === 'table') {
                            focusReq.current = {
                                id: tableCellId(lastInserted.id, 0, 0),
                                pos: 'start',
                            };
                        } else if (isEditableType(lastInserted.type)) {
                            focusReq.current = {id: lastInserted.id, pos: 'end'};
                        }
                        return;
                    }
                }
            } catch {
                // Fall through to interoperable plain-text paste.
            }
        }
        const text = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
        // Code takes the plain text whatever the HTML holds, so there is nothing to import.
        if (block.type === 'code' && (ends || replaced.length <= 1)) {
            if (!text) return;
            if (ends) {
                pasteInlineAcross(ends, escapeHtml(text));
                return;
            }
            insertPlainTextAtCaret(text);
            commitHtml(id, el);
            return;
        }
        const html = e.clipboardData.getData('text/html');
        const imported = html ? htmlToBlocks(html) : null;
        const rich = imported && normalizeParsedBlocks(imported);
        if (!text && !rich) return;

        if (!rich && text.includes('\n') && hasUnsupportedMarkdown(text)) {
            showToast('This Markdown needs source mode. Switch to source to paste it safely.');
            return;
        }
        if (ends) {
            if (rich) pasteBlocksAcross(ends, rich, text, 'rich');
            else if (text.includes('\n')) {
                pasteBlocksAcross(
                    ends,
                    normalizeParsedBlocks(markdownToBlocks(text)),
                    text,
                    'markdown',
                );
            } else pasteInlineAcross(ends, sanitizeInlineHtml(inlineMarkdownToHtml(text)));
            return;
        }

        if (replaced.length > 1) {
            if (rich) replaceWithBlocks(replaced, rich);
            else replaceWithMarkdown(replaced, text);
            return;
        }

        const selection = window.getSelection();
        if (
            selection &&
            !selection.isCollapsed &&
            /^https?:\/\/\S+$/i.test(text.trim()) &&
            block.type !== 'code'
        ) {
            document.execCommand('createLink', false, text.trim());
            commitHtml(id, el);
            return;
        }

        if (rich) {
            pasteBlocks(id, el, block, rich, text);
            return;
        }
        if (!text.includes('\n')) {
            insertInlineMarkdown(text);
            commitHtml(id, el);
            return;
        }

        if (hasUnsupportedMarkdown(text)) {
            showToast('This Markdown needs source mode. Switch to source to paste it safely.');
            return;
        }
        if (block.type === 'text' && isEmptyHtml(el.innerHTML)) {
            replaceWithMarkdown([id], text);
            return;
        }

        const lines = text.replace(/\r/g, '').split('\n');
        const first = lines.shift() ?? '';
        // Pasted text is read as Markdown, by the same parser that loads a note — so a pasted list,
        // heading, or table arrives as real blocks rather than as literal syntax. Same sanitising
        // pass as the load path: the clipboard is as untrusted as a file.
        splitAtCaret(
            id,
            el,
            block,
            escapeHtml(first),
            normalizeParsedBlocks(markdownToBlocks(lines.join('\n'))),
        );
    };

    const pasteBlocks = (
        id: string,
        el: HTMLElement,
        block: BlockData,
        pasted: BlockData[],
        text: string,
    ) => {
        const [first, ...others] = pasted;
        // The import trims each paragraph's edges; a selection taken mid-sentence had the spaces.
        const lead = /^\s/.test(text) ? ' ' : '';
        const trail = /\s$/.test(text) ? ' ' : '';
        if (!others.length && first.type === 'text') {
            const html = `${lead}${oneLineIfHeading(block.type, first.html)}${trail}`;
            document.execCommand('insertHTML', false, html);
            commitHtml(id, el);
            return;
        }
        if (block.type === 'text' && isEmptyHtml(el.innerHTML)) {
            replaceWithBlocks([id], pasted);
            return;
        }
        if (first.type === 'text' && !first.depth) {
            splitAtCaret(
                id,
                el,
                block,
                oneLineIfHeading(block.type, first.html),
                others,
                lead,
                trail,
            );
        } else splitAtCaret(id, el, block, '', pasted, '', trail);
    };

    const splitAtCaret = (
        id: string,
        el: HTMLElement,
        block: BlockData,
        firstHtml: string,
        pasted: BlockData[],
        leadSpace = '',
        trailSpace = '',
    ) => {
        const [beforeHtml, afterHtml] = splitHtmlAtCaret(el);
        // Only where text meets text: a paragraph never starts or ends on a space of its own.
        const lead = beforeHtml && firstHtml ? leadSpace : '';
        const trail = afterHtml ? trailSpace : '';
        const rest = pasted.map((parsed) => ({
            ...decorateBlock(parsed, decorateRef.current),
            depth: (block.depth ?? 0) + (parsed.depth ?? 0),
        }));
        const lastBlock = rest[rest.length - 1];
        let caretTarget: {id: string; pos: CaretPos} = {id, pos: 'end'};
        if (lastBlock && isEditableType(lastBlock.type)) {
            const lastLen = htmlToText(lastBlock.html).length;
            lastBlock.html += trail + afterHtml;
            caretTarget = {id: lastBlock.id, pos: lastLen};
        } else if (afterHtml) {
            const suffix = {...newBlock('text', afterHtml), depth: block.depth ?? 0};
            rest.push(suffix);
            caretTarget = {id: suffix.id, pos: 'start'};
        }
        const idx = indexOf(id);
        setBlocks((bs) => {
            const arr = bs.map((b) =>
                b.id === id ? {...b, html: beforeHtml + lead + firstHtml} : b,
            );
            // With the caret at the end the host's children stay the host's; with text after the
            // caret they follow that text, which now ends the pasted run.
            arr.splice(afterHtml ? idx + 1 : afterSubtree(arr, idx), 0, ...rest);
            // The pasted depths are ADDED to the host block's, so pasting a nested list deep in one
            // can push past the limit — and blocks carrying their own depths into a new place can
            // land deeper than their new neighbourhood holds either way.
            return normalizeDepths(arr);
        });
        focusReq.current = caretTarget;
    };

    // ----- block selection (Escape / ⌘A) -----

    /**
     * Whether a document-level key/clipboard event is this editor's to act on.
     *
     * These listeners are on `document` because selecting a block BLURS its contentEditable — the
     * events then land on `<body>` with nothing focused, so "inside `rootRef`" alone would break
     * the whole selection model. What has to be excluded is ANOTHER surface owning the keyboard:
     * ⌘L jumps to the app's search box without any pointer event, so the `mousedown` clearer below
     * never ran and the block selection stayed live behind it. Backspace to fix a typo in the query
     * then deleted a block from the note (and autosaved the deletion), ⌘A selected every block
     * instead of the query text, and ⌘C copied blocks instead of the selected text.
     *
     * The editor's own overlays are excluded too. They are on screen BECAUSE the reader opened them
     * and they drive the keyboard themselves — and since they portal out to `<body>` under a host
     * that re-applies the editor's scope class, the "inside the editor" test below says yes to
     * them. This listener captures on `document`, ahead of React, so without the exclusion it ate
     * the arrows the block menu walks its rows with (the menu's own handler never ran at all) and
     * the Escape that should merely close a submenu, which instead stepped out to the note list.
     * A menu that advertises a shortcut therefore honours it itself (see BlockMenu).
     */
    const ownsDocumentEvent = (target: EventTarget | null): boolean => {
        if (!(target instanceof HTMLElement)) return true; // document-level: nothing else focused
        if (target === document.body || target === document.documentElement) return true;
        // Asked of the portal HOST, not of the classes each overlay happens to use: every overlay
        // goes through OverlayPortal, so a new one is covered the day it is written.
        if (target.closest(`.${OVERLAY_HOST_CLASS}`)) return false;
        if (!target.closest('.gn-block-editor')) return false;
        return !(
            target.isContentEditable ||
            target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA'
        );
    };

    const onSelectionKeyDown = (e: globalThis.KeyboardEvent) => {
        if (!ownsDocumentEvent(e.target)) return;
        const selected = selectedIdsRef.current;
        const mod = e.metaKey || e.ctrlKey;
        const chordType = blockTypeChord(e);
        if (chordType) {
            claimChord(e);
            applyBlockType(chordType);
            return;
        }
        // ⌘↑ / ⌘↓ move the selected blocks (⌘⌥ too, the chord this used to be).
        if (mod && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            claimChord(e);
            moveSelectedBlocks(e.key === 'ArrowUp' ? -1 : 1);
        } else if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            claimChord(e);
            const direction = e.key === 'ArrowUp' ? -1 : 1;
            const {focus, edge} = selectionEnds(direction);
            if (focus < 0) return;
            // The next VISIBLE block, like the plain-arrow branch below: extending onto one hidden
            // inside a collapsed toggle showed nothing new (a hidden block renders no element and
            // `revealBlock` is a silent no-op on it), so ⇧↑ looked like it had done nothing — and
            // the next Delete took content the user had never seen highlighted.
            const nextIndex = nextVisibleIndex(focus, direction);
            if (nextIndex === null) return;
            const anchorId = selectionAnchor.current ?? blocksRef.current[edge].id;
            selectBlockRange(anchorId, blocksRef.current[nextIndex].id);
            revealBlock(blocksRef.current[nextIndex].id);
        } else if (!mod && !e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            // Move the selection to the previous/next block. Without this the arrows fell through
            // to the browser and SCROLLED THE PAGE, which is never what an arrow means while a
            // block is selected. Claiming the chord is also what stops that default scroll.
            claimChord(e);
            const direction = e.key === 'ArrowUp' ? -1 : 1;
            const {focus} = selectionEnds(direction);
            if (focus < 0) return;
            // At either end, stay put rather than let the page scroll instead.
            const nextIndex = nextVisibleIndex(focus, direction);
            if (nextIndex === null) return;
            const nextId = blocksRef.current[nextIndex].id;
            selectSingleBlock(nextId);
            revealBlock(nextId);
        } else if (e.key === 'Backspace' || e.key === 'Delete') {
            // ⌘⇧⌫ is the app's "move note to Trash" chord, not a block delete — the per-block
            // handler already yields it, and this one must too. Without the guard the blocks were
            // removed behind the confirm dialog, so CANCELLING still lost them.
            if (mod && e.shiftKey) return;
            claimChord(e);
            removeBlocks([...selected]);
        } else if (e.key === 'Enter' && !mod && !e.altKey && !e.shiftKey) {
            claimChord(e);
            editSelectedBlock();
        } else if (e.key === 'Tab' && !mod && !e.altKey) {
            // Without this the browser took Tab and walked focus onto the block furniture, so the
            // one key that means "indent" everywhere else in the editor lost the selection instead.
            claimChord(e);
            changeSelectedDepth(e.shiftKey ? -1 : 1);
        } else if (e.key === 'Escape') {
            clearBlockSelection();
            // Nothing left in the editor to dismiss: the shell walks focus back to the note list.
            onEscape?.();
        } else if (mod && e.key.toLowerCase() === 'd') {
            claimChord(e);
            duplicateBlocks([...selected], true);
        } else if (mod && e.key.toLowerCase() === 'a') {
            claimChord(e);
            dropCaret();
            selectionAnchor.current = blocksRef.current[0]?.id ?? null;
            selectionFocus.current = blocksRef.current[blocksRef.current.length - 1]?.id ?? null;
            setSelectedIds(new Set(blocksRef.current.map((b) => b.id)));
        } else if (mod && e.key.toLowerCase() === 'z') {
            claimChord(e);
            restoreHistory(e.shiftKey ? 'redo' : 'undo');
        }
    };

    /**
     * Put whole blocks on the clipboard — the app's own JSON for a paste back into the editor, and
     * Markdown for everywhere else — and remove them when this is a cut.
     *
     * `scope` carries the caller's gesture through to the removal, exactly as {@link removeBlocks}
     * describes: a BLOCK selection is a selection of subtrees, a TEXT selection is what is
     * highlighted. Cutting had to be told that too, or ⌘X over the same range that Backspace now
     * handles correctly still took the children the user had watched stay unhighlighted.
     */
    const writeClipboardBlocks = (data: DataTransfer | null, blocks: BlockData[]) => {
        data?.setData('application/x-notion-editor-blocks', JSON.stringify(blocks));
        data?.setData('text/plain', blocksToClipboardMarkdown(blocks));
    };

    const writeBlocksToClipboard = (
        data: DataTransfer | null,
        ids: Iterable<string>,
        cut: boolean,
        scope: 'subtree' | 'exact' = 'subtree',
    ) => {
        const selectedIds = blocksInScope(ids, scope);
        const selected = blocksRef.current.filter((block) => selectedIds.has(block.id));
        if (!selected.length) return;
        writeClipboardBlocks(data, selected);
        const noun = selected.length === 1 ? 'block' : 'blocks';
        showToast(`${cut ? 'Cut' : 'Copied'} ${selected.length} ${noun}`);
        // `'exact'`, whatever the scope was: the set is already expanded, and expanding it a
        // second time is what let the removal outrun the clipboard.
        if (cut)
            removeBlocks(
                selected.map((block) => block.id),
                'exact',
            );
    };

    // Text that arrives with no keydown — dictation, the emoji picker, autocorrect — over a
    // selection crossing blocks: the browser would edit only the block with focus.
    const onBeforeInputAcross = (e: InputEvent) => {
        if (!e.cancelable || !crossesBlocks()) return;
        const spanned = selectionBlockIds();
        if (spanned.length < 2) return;
        const ends = textSelectionAcross(spanned);
        if (!ends) return;
        if (e.inputType === 'insertParagraph') {
            e.preventDefault();
            splitAcross(ends);
        } else if (
            e.inputType.startsWith('insert') &&
            e.inputType !== 'insertFromPaste' &&
            e.inputType !== 'insertFromDrop'
        ) {
            e.preventDefault();
            deleteAcross(ends, e.data ?? e.dataTransfer?.getData('text/plain') ?? '');
        } else if (e.inputType.startsWith('delete')) {
            e.preventDefault();
            deleteAcross(ends);
        }
    };
    const beforeInputRef = useRef(onBeforeInputAcross);
    beforeInputRef.current = onBeforeInputAcross;
    useEffect(() => {
        const root = rootRef.current;
        if (!root) return undefined;
        const listener = (e: Event) => beforeInputRef.current(e as InputEvent);
        root.addEventListener('beforeinput', listener);
        return () => root.removeEventListener('beforeinput', listener);
    }, []);

    const onSelectionClipboard = (e: globalThis.ClipboardEvent) => {
        if (!ownsDocumentEvent(e.target)) return;
        if (!expandBlockIds(blocksRef.current, selectedIdsRef.current).size) return;
        e.preventDefault();
        writeBlocksToClipboard(e.clipboardData, selectedIdsRef.current, e.type === 'cut');
    };

    // Deliberately NOT scoped to the editor: a click anywhere else is exactly what should drop the
    // selection. Only the block furniture that acts on it is exempt.
    const onSelectionMouseDown = (e: globalThis.MouseEvent) => {
        const target = e.target as HTMLElement | null;
        if (target?.closest('.drag-btn, .block-menu')) return;
        clearBlockSelection();
    };

    // The listeners are registered once per "is anything selected" transition rather than on every
    // change of the set: they used to depend on `selectedIds` itself, so a marquee drag tore down
    // and re-added four document listeners on every pointermove. They read the live set and the
    // live callbacks through refs instead.
    selectionListeners.current = {
        onKeyDown: onSelectionKeyDown,
        onClipboard: onSelectionClipboard,
        onMouseDown: onSelectionMouseDown,
    };
    const hasBlockSelection = selectedIds.size > 0;

    useEffect(() => {
        if (!hasBlockSelection) return undefined;
        const onKey = (e: globalThis.KeyboardEvent) => selectionListeners.current.onKeyDown(e);
        const onClipboard = (e: globalThis.ClipboardEvent) =>
            selectionListeners.current.onClipboard(e);
        const onMouseDown = (e: globalThis.MouseEvent) => selectionListeners.current.onMouseDown(e);
        // CAPTURE: `useShortcuts` registers its own document listener at Workspace mount, i.e.
        // before this one, so on the bubble path registration order would give the global handler
        // the chord first. Capturing puts us ahead of it regardless of mount order.
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('mousedown', onMouseDown);
        document.addEventListener('copy', onClipboard);
        document.addEventListener('cut', onClipboard);
        return () => {
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('copy', onClipboard);
            document.removeEventListener('cut', onClipboard);
        };
    }, [hasBlockSelection]);

    // ----- drag & drop -----

    /**
     * Auto-scroll while dragging near the pane's edges — the pane scrolls this editor, not the
     * window (see autoScroll.ts). Kept in a ref: a scroller is a live resource, and re-creating one
     * per render would strand its frame loop.
     */
    // Lazily: `useRef(expr)` evaluates `expr` on EVERY render — and this editor re-renders on every
    // keystroke — allocating a scroller per character only to throw it away.
    const edgeScrollerRef = useRef<EdgeScroller | null>(null);
    if (!edgeScrollerRef.current) {
        edgeScrollerRef.current = createEdgeScroller(() => scrollContainerRef?.current ?? null);
    }
    const edgeScroller = edgeScrollerRef.current;

    const long = blocks.length >= LONG_DOCUMENT_BLOCKS;
    useScrollAnchoring(rootRef, scrollContainerRef, long);

    // A long note mounts a drag handle only where one can be seen or used: most of a note's DOM
    // was handles nobody was pointing at.
    const hoverRef = useRef<HoverStore | null>(null);
    hoverRef.current ??= createHoverStore();
    const hover = hoverRef.current;
    const [handleFocusId, setHandleFocusId] = useState<string | null>(null);
    const showsHandle = (id: string) =>
        !long ||
        selectedIds.has(id) ||
        draggedIds.has(id) ||
        id === focusedId ||
        id === handleFocusId ||
        id === blockMenu?.id;
    // Only a block sets it, so crossing the gap between a block and its handle keeps the handle. In
    // the gutter, where no handle is mounted yet, the block is the one level with the pointer.
    const onRootMouseMove = (e: MouseEvent<HTMLDivElement>) => {
        if (!long) return;
        let block = (e.target as Element).closest<HTMLElement>('.blocks > .block');
        if (!block) {
            const list = rootRef.current?.querySelector('.blocks')?.getBoundingClientRect();
            if (list && e.clientX < list.left) {
                block =
                    document
                        .elementFromPoint?.(list.right - 2, e.clientY)
                        ?.closest<HTMLElement>('.blocks > .block') ?? null;
            }
        }
        if (block) hover.set(block.id);
    };
    const onRootFocusChange = (e: FocusEvent<HTMLDivElement>) => {
        if (!long) return;
        const handleOf = (target: EventTarget | null) =>
            target instanceof Element && target.closest('.drag-btn')
                ? (target.closest<HTMLElement>('.blocks > .block')?.id ?? null)
                : null;
        setHandleFocusId(e.type === 'focus' ? handleOf(e.target) : handleOf(e.relatedTarget));
    };

    // `dragover` on the document, not on each block: the pointer spends a good part of a drag over
    // the gap below the last block (or over another block's furniture), and those frames are
    // exactly the ones that need to keep scrolling.
    useEffect(() => {
        if (!draggingRoots) return undefined;
        const scroller = edgeScroller;
        const onDragOverDocument = (e: globalThis.DragEvent) => scroller.to(e.clientY);
        document.addEventListener('dragover', onDragOverDocument);
        return () => {
            document.removeEventListener('dragover', onDragOverDocument);
            scroller.stop();
        };
    }, [draggingRoots]);

    const onDragStart = (e: DragEvent<HTMLButtonElement>, id: string) => {
        // A handle inside the current block SELECTION drags the whole selection — what the reader
        // highlighted is what moves. Dragging one of several selected blocks and watching the rest
        // stay put is the kind of thing that makes a surface feel like it isn't listening.
        const selected = selectedIdsRef.current;
        const roots = selected.has(id) ? selectionRoots(blocksRef.current, selected) : [id];
        e.dataTransfer.setData('text/plain', roots.join('\n'));
        e.dataTransfer.effectAllowed = 'move';
        const blockEl = (e.currentTarget as HTMLElement).closest('.block');
        if (blockEl) e.dataTransfer.setDragImage(blockEl, 20, 10);
        // Defer: mutating the DOM inside dragstart cancels the drag in Chrome.
        setTimeout(() => setDraggingRoots(roots), 0);
    };

    const onDragOver = (e: DragEvent<HTMLDivElement>, id: string) => {
        if (!draggingRoots) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const edge = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
        setDropTarget((t) => (t && t.id === id && t.edge === edge ? t : {id, edge}));
    };

    const endDrag = () => {
        edgeScroller.stop();
        setDraggingRoots(null);
        setDropTarget(null);
    };

    const onDrop = (e: DragEvent<HTMLDivElement>, id: string) => {
        e.preventDefault();
        const images = imageFilesFrom(e.dataTransfer.files);
        const others = otherFilesFrom(e.dataTransfer.files);
        if ((images.length || others.length) && onAttachFile) {
            endDrag();
            if (images.length) void insertImageFiles(id, images);
            if (others.length) void insertAttachmentFiles(id, others);
            return;
        }
        // The state is set on a deferred tick (see above), so a very fast drag can drop before it
        // lands — the ids ride on the dataTransfer for exactly that case.
        const src =
            draggingRoots ?? e.dataTransfer.getData('text/plain').split('\n').filter(Boolean);
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const edge = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
        endDrag();
        if (src.length) moveBlocks(src, id, edge);
    };

    const onDragEnd = endDrag;

    // ----- hover controls -----

    /** The block menu's "Add block below": an empty line after the block, with the slash menu open. */
    const addBlockBelow = (id: string) => {
        const block = findBlock(id);
        if (!block) return;
        if (block.type === 'text' && isEmptyHtml(block.html)) {
            focusNow(id, 'start');
            const el = refs.current.get(id);
            openSlashMenu(id, el ? getCaretOffset(el) : 0, 0);
            return;
        }
        const nb = {...newBlock('text'), depth: block.depth ?? 0};
        // After the block's children, which stay its own.
        setBlocks((bs) => {
            const at = afterSubtree(
                bs,
                bs.findIndex((candidate) => candidate.id === id),
            );
            return [...bs.slice(0, at), nb, ...bs.slice(at)];
        });
        focusReq.current = {id: nb.id, pos: 'start'};
        openMenuFor.current = nb.id;
    };

    const onHandleClick = (e: MouseEvent<HTMLButtonElement>, id: string) => {
        if (e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            const anchor = selectionAnchor.current ?? [...selectedIds][0] ?? id;
            selectBlockRange(anchor, id);
            setBlockMenu(null);
            return;
        }
        if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            e.stopPropagation();
            const next = new Set(selectedIds);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            selectionAnchor.current ??= id;
            selectionFocus.current = id;
            setSelectedIds(next);
            setBlockMenu(null);
            return;
        }
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        selectSingleBlock(id);
        // Viewport coordinates — see openSlashMenu.
        setBlockMenu({id, x: rect.left, y: rect.bottom + 4});
    };

    // ----- pointer block selection -----

    const onSelectionPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
        if (e.button !== 0 || e.pointerType !== 'mouse') return;
        const target = e.target as HTMLElement;
        if (target.closest('.block-body, button, a, input, textarea')) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const base = e.metaKey || e.ctrlKey ? new Set(selectedIds) : new Set<string>();
        selectionDrag.current = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            base,
            moved: false,
            additive: e.metaKey || e.ctrlKey,
            // Measure every block ONCE, here. Nothing re-lays the document out while a marquee is
            // being dragged (the drawn rectangle assumes the same), so re-reading N
            // getBoundingClientRect()s on every pointermove only bought a forced layout per frame.
            rects: [...(rootRef.current?.querySelectorAll<HTMLElement>('.block') ?? [])].map(
                (element) => ({id: element.id, rect: element.getBoundingClientRect()}),
            ),
            hits: new Set(base),
        };
        selectionWasDragged.current = false;
    };

    const onSelectionPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
        const drag = selectionDrag.current;
        if (!drag || drag.pointerId !== e.pointerId) return;
        const distance = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
        if (!drag.moved && distance < DRAG_SLOP) return;
        if (!drag.moved) {
            // A BLOCK gesture from here, so the caret goes rather than blinking inside a block while
            // a marquee is drawn over it.
            dropCaret();
            if (!drag.additive) clearBlockSelection();
        }
        drag.moved = true;
        selectionWasDragged.current = true;
        const left = Math.min(drag.startX, e.clientX);
        const top = Math.min(drag.startY, e.clientY);
        const right = Math.max(drag.startX, e.clientX);
        const bottom = Math.max(drag.startY, e.clientY);
        setSelectionBox({left, top, width: right - left, height: bottom - top});

        const next = new Set(drag.base);
        for (const {id, rect} of drag.rects) {
            if (
                rect.right >= left &&
                rect.left <= right &&
                rect.bottom >= top &&
                rect.top <= bottom
            )
                next.add(id);
        }
        // Most frames of a drag cross no block boundary; re-setting an equal Set would still be a
        // new identity and re-render the whole document.
        if (!sameIds(drag.hits, next)) {
            drag.hits = next;
            setSelectedIds(next);
            const ordered = blocksRef.current.filter((block) => next.has(block.id));
            selectionAnchor.current = ordered[0]?.id ?? null;
            selectionFocus.current = ordered[ordered.length - 1]?.id ?? null;
        }

        // Same scroller as a block drag: dragging a marquee past the edge of the pane has to bring
        // the rest of the note into view. This used to scroll the WINDOW, which scrolls nothing
        // here — so a selection could never reach beyond one screenful.
        edgeScroller.to(e.clientY);
    };

    const finishSelectionPointer = (e: ReactPointerEvent<HTMLElement>) => {
        const drag = selectionDrag.current;
        if (!drag || drag.pointerId !== e.pointerId) return;
        if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        selectionDrag.current = null;
        edgeScroller.stop();
        setSelectionBox(null);
        // Below the last block is `onPageClick`'s: it opens a new line there.
        const last = drag.rects[drag.rects.length - 1];
        if (!drag.moved && !drag.additive && e.type === 'pointerup') {
            clearBlockSelection();
            if (last && e.clientY <= last.rect.bottom)
                placeCaretNear(e.clientX, e.clientY, drag.rects);
        }
    };

    /**
     * A press on the furniture around the text — the gap between blocks, the padding round an empty
     * line — is a marquee only once it moves; one that never does was a click, and the caret
     * belongs in the line nearest to it.
     */
    const placeCaretNear = (x: number, y: number, rects: {id: string; rect: DOMRect}[]) => {
        let nearest: {el: HTMLElement; distance: number} | null = null;
        for (const {id, rect} of rects) {
            const el = refs.current.get(id);
            if (!el || rect.height === 0) continue;
            const distance = Math.max(rect.top - y, y - rect.bottom, 0);
            if (!nearest || distance < nearest.distance) nearest = {el, distance};
        }
        if (!nearest) return;
        nearest.el.focus({preventScroll: true});
        setCaretAtPoint(nearest.el, x, y, 'end');
    };

    // ----- page & title -----

    const onPageClick = (e: MouseEvent<HTMLDivElement>) => {
        if (selectionWasDragged.current) {
            selectionWasDragged.current = false;
            return;
        }
        if (e.target !== e.currentTarget) return;
        const bs = blocksRef.current;
        const last = bs[bs.length - 1];
        const lastEl = last ? refs.current.get(last.id) : null;
        const rect = lastEl?.getBoundingClientRect();
        if (rect && e.clientY <= rect.bottom) return;
        if (last && last.type === 'text' && isEmptyHtml(last.html)) {
            focusNow(last.id, 'end');
            return;
        }
        const nb = newBlock('text');
        setBlocks((prev) => [...prev, nb]);
        focusReq.current = {id: nb.id, pos: 'start'};
    };

    // ----- render -----

    const numbers = listNumbers(blocks);

    const visibleIds = visibleBlockIds(blocks);
    const menuFor = (id: string) => {
        if (slash?.blockId === id && filteredItems.length > 0) {
            const item = filteredItems[Math.min(slashIndex, filteredItems.length - 1)];
            return {listbox: SLASH_MENU_ID, option: `slash-option-${item.type}`};
        }
        if (wiki?.blockId === id && wikiItems.length > 0) {
            const index = Math.min(wikiIndex, wikiItems.length - 1);
            return {listbox: WIKI_MENU_ID, option: wikiOptionId(index)};
        }
        return undefined;
    };

    const nextHandlers: BlockHandlers = {
        hover,
        onContentRef: (id, el) => {
            if (el) refs.current.set(id, el);
            else refs.current.delete(id);
        },
        onNormalize: normalizeHtml,
        onInput,
        onCompositionStart: () => {
            composingRef.current = true;
        },
        onCompositionEnd: (id) => {
            composingRef.current = false;
            // The composed text landed while decoration was suppressed; catch it up now.
            const el = refs.current.get(id);
            if (el) commitHtml(id, el);
        },
        onUpdateImage: (id, image) =>
            setBlocks((current) =>
                current.map((block) =>
                    block.id === id && block.image
                        ? {...block, image: {...block.image, ...image}}
                        : block,
                ),
            ),
        onKeyDown,
        onPaste,
        onCopyCut,
        onFocus: (id) => {
            setFocusedId(id);
            lastFocusedRef.current = id;
        },
        onBlur: (id) => setFocusedId((cur) => (cur === id ? null : cur)),
        onToggleTodo: (id) =>
            setBlocks((bs) => bs.map((b) => (b.id === id ? {...b, checked: !b.checked} : b))),
        onPickLanguage: (id, anchor) =>
            setPicker({kind: 'language', id, x: anchor.left, y: anchor.bottom + 6}),
        onPickCalloutKind: (id, anchor) =>
            setPicker({kind: 'callout', id, x: anchor.left, y: anchor.bottom + 6}),
        onEditAnchor: (id, anchor) => setAnchorEdit({id, x: anchor.left, y: anchor.bottom + 6}),
        onCopyCode: (id) => {
            const block = findBlock(id);
            if (!block) return;
            void writeClipboardText(inlineHtmlToCodeText(block.html)).then(
                () => showToast('Copied'),
                () => showToast('Could not write to the clipboard'),
            );
        },
        onToggleCollapse: (id) =>
            setBlocks((bs) => bs.map((b) => (b.id === id ? {...b, collapsed: !b.collapsed} : b))),
        onTableCellRef: (id, element) => {
            if (element) tableRefs.current.set(id, element);
            else tableRefs.current.delete(id);
        },
        onTableCellInput: (id, row, column, html) => updateTableCell(id, row, column, html),
        onTableCellKeyDown,
        onTableCellPaste,
        onTableCellFocus: (id) => setFocusedId(id),
        onTableAddRow: addTableRow,
        onTableAddColumn: addTableColumn,
        onTableDeleteRow: deleteTableRow,
        onTableDeleteColumn: deleteTableColumn,
        onTableToggleHeaderRow: (id) =>
            updateTable(id, (table) => ({...table, headerRow: !table.headerRow})),
        onTableToggleHeaderColumn: (id) => {
            updateTable(id, (table) => ({...table, headerColumn: !table.headerColumn}));
            // GFM tables have a header ROW and nothing else, so this one is presentation only —
            // unlike the "Header row" toggle beside it, which does persist. Two adjacent, identical
            // -looking controls behaving differently is exactly what needs saying out loud.
            showToast('A header column isn’t saved to Markdown');
        },
        onContentMouseDown,
        onSelectBlock: selectSingleBlock,
        onHandleClick,
        onDragStart,
        onDragEnd,
        onDragOver,
        onDrop,
    };

    /**
     * ONE handlers object for the document's whole life, its fields re-pointed at this render's
     * closures.
     *
     * `Block` is memoized, so a keystroke should re-render only the block that changed. Handing
     * every block a fresh object literal defeated that outright — the prop differed, so all of them
     * re-rendered: 10.4 / 48.4 / 117.3 ms per keystroke at 200 / 1000 / 2500 blocks, against
     * 1.6 / 8.2 / 10.0 ms with this in place. Mutating rather than replacing is what keeps the
     * identity stable, and the fields are reassigned on EVERY render, so the closures a block calls
     * are always the current ones — nothing here is captured from an older render.
     */
    const handlersRef = useRef(nextHandlers);
    const handlers = Object.assign(handlersRef.current, nextHandlers);

    const menuBlock = blockMenu ? findBlock(blockMenu.id) : undefined;

    return (
        <div
            className={`gn-block-editor${long ? ' gn-block-editor_long' : ''}`}
            ref={rootRef}
            onClick={onRootClick}
            onMouseMove={onRootMouseMove}
            onMouseLeave={() => hover.set(null)}
            onFocus={onRootFocusChange}
            onBlur={onRootFocusChange}
        >
            <main
                className="page"
                onClick={onPageClick}
                onPointerDown={onSelectionPointerDown}
                onPointerMove={onSelectionPointerMove}
                onPointerUp={finishSelectionPointer}
                onPointerCancel={finishSelectionPointer}
                aria-label="Document editor"
            >
                <div className="blocks">
                    {blocks
                        .filter((b) => visibleIds.has(b.id))
                        .map((b) => (
                            <Block
                                key={b.id}
                                block={b}
                                listNumber={numbers.get(b.id)?.ordinal ?? 1}
                                selected={selectedIds.has(b.id)}
                                dragging={draggedIds.has(b.id)}
                                dropEdge={dropTarget?.id === b.id ? dropTarget.edge : null}
                                placeholder={placeholderFor(
                                    b,
                                    focusedId === b.id,
                                    blocks.length === 1,
                                )}
                                menu={menuFor(b.id)}
                                handle={showsHandle(b.id)}
                                menuOpen={blockMenu?.id === b.id}
                                handlers={handlers}
                            />
                        ))}
                </div>
            </main>

            {selectionBox && (
                // Viewport coordinates (from pointer clientX/Y), so it has to escape the host pane's
                // `transform` like the other overlays — otherwise the rectangle is drawn offset from
                // the pointer and the blocks it "covers" are the wrong ones.
                <OverlayPortal>
                    <div className="selection-rect" style={selectionBox} aria-hidden="true" />
                </OverlayPortal>
            )}

            {!hidden && slash && (
                <SlashMenu
                    anchor={slash.rect}
                    items={filteredItems}
                    activeIndex={slashIndex}
                    onHover={setSlashIndex}
                    onSelect={applySlashItem}
                    onClose={() => setSlash(null)}
                />
            )}
            {!hidden && wiki && wikiItems.length > 0 && (
                <WikiSuggestMenu
                    anchor={wiki.rect}
                    items={wikiItems}
                    activeIndex={Math.min(wikiIndex, wikiItems.length - 1)}
                    onHover={setWikiIndex}
                    onSelect={applyWikiItem}
                    onClose={() => setWiki(null)}
                />
            )}
            {!hidden && blockMenu && menuBlock && (
                <BlockMenu
                    x={blockMenu.x}
                    y={blockMenu.y}
                    currentType={menuBlock.type}
                    currentColor={menuBlock.color}
                    onAddBelow={() => {
                        setBlockMenu(null);
                        addBlockBelow(blockMenu.id);
                    }}
                    onDelete={() => {
                        setBlockMenu(null);
                        removeBlocks([blockMenu.id]);
                    }}
                    onDuplicate={() => {
                        setBlockMenu(null);
                        duplicateBlocks([blockMenu.id], false);
                    }}
                    onTurnInto={(type) => {
                        setBlockMenu(null);
                        turnInto(blockMenu.id, type);
                    }}
                    onColor={(color) => {
                        const ids = selectedIds.has(blockMenu.id)
                            ? selectedIds
                            : new Set([blockMenu.id]);
                        setBlocks((current) =>
                            current.map((block) =>
                                ids.has(block.id) && canCarryColor(block.type)
                                    ? {...block, color: color === 'default' ? undefined : color}
                                    : block,
                            ),
                        );
                        setBlockMenu(null);
                        // A colour rides on the block's own text (`{red}(…)`), so the two types with
                        // no text to wrap can't keep one. They used to take the colour on screen and
                        // lose it on reopen; refusing it out loud is the honest version.
                        const refused = blocksRef.current.filter(
                            (block) => ids.has(block.id) && !canCarryColor(block.type),
                        );
                        if (color !== 'default' && refused.length)
                            showToast(
                                `A ${COLORLESS_NOUN[refused[0].type] ?? 'block'} can’t carry a colour`,
                            );
                    }}
                    anchor={
                        menuBlock.type.startsWith('heading')
                            ? {
                                  label: menuBlock.headingAnchor ? 'Edit anchor' : 'Add anchor',
                                  onEdit: () => {
                                      const id = blockMenu.id;
                                      setBlockMenu(null);
                                      const rect = document
                                          .getElementById(id)
                                          ?.querySelector('.heading-anchor, .content')
                                          ?.getBoundingClientRect();
                                      if (rect) {
                                          setAnchorEdit({id, x: rect.left, y: rect.bottom + 6});
                                      }
                                  },
                              }
                            : undefined
                    }
                    onClose={() => setBlockMenu(null)}
                />
            )}
            {anchorEdit && (
                <AnchorEditor
                    x={anchorEdit.x}
                    y={anchorEdit.y}
                    anchor={findBlock(anchorEdit.id)?.headingAnchor}
                    onSave={(headingAnchor, fromKeyboard) => {
                        if (findBlock(anchorEdit.id)?.headingAnchor !== headingAnchor) {
                            setBlocks((current) =>
                                current.map((block) =>
                                    block.id === anchorEdit.id ? {...block, headingAnchor} : block,
                                ),
                            );
                        }
                        setAnchorEdit(null);
                        if (fromKeyboard) focusReq.current = {id: anchorEdit.id, pos: 'end'};
                    }}
                    onClose={() => {
                        setAnchorEdit(null);
                        focusReq.current = {id: anchorEdit.id, pos: 'end'};
                    }}
                />
            )}
            {picker && (
                <PickerMenu
                    x={picker.x}
                    y={picker.y}
                    label={PICKERS[picker.kind].label}
                    filterable={PICKERS[picker.kind].filterable}
                    items={
                        picker.kind === 'callout' && findBlock(picker.id)?.yfm?.kind === 'note'
                            ? [
                                  ...CALLOUT_ITEMS.filter((item) =>
                                      ['info', 'tip', 'warning'].includes(item.value),
                                  ),
                                  {value: 'alert', label: 'Alert', icon: '⚠️'},
                              ]
                            : PICKERS[picker.kind].items
                    }
                    current={
                        findBlock(picker.id)?.[PICKERS[picker.kind].field] ??
                        PICKERS[picker.kind].fallback
                    }
                    onPick={(value) => {
                        const {field} = PICKERS[picker.kind];
                        setBlocks((current) =>
                            current.map((block) =>
                                block.id === picker.id
                                    ? {...block, [field]: value || undefined}
                                    : block,
                            ),
                        );
                        setPicker(null);
                    }}
                    onClose={() => setPicker(null)}
                />
            )}
            {linkTip && (
                <OverlayPortal>
                    <WikiLinkTip
                        x={linkTip.x}
                        y={linkTip.y}
                        anchorTop={linkTip.top}
                        label={`Link to ${linkTip.target}`}
                        layoutKey={`${tipEdit?.kind}:${noteQuery}:${noteChangeItems.length}`}
                        activeIndex={tipEdit?.kind === 'note' ? tipEdit.index : undefined}
                    >
                        {tipEdit?.kind === 'note' ? (
                            // The popup's own note search: picking a row re-points the link and
                            // keeps its display text; Esc leaves the note exactly as it was.
                            <div className="wiki-tip-search">
                                <input
                                    className="wiki-tip-input"
                                    aria-label="Search notes"
                                    role="combobox"
                                    aria-expanded
                                    aria-controls="wiki-tip-options"
                                    aria-activedescendant={
                                        noteChangeItems.length > 0
                                            ? `wiki-tip-option-${tipEdit.index}`
                                            : undefined
                                    }
                                    value={tipEdit.query}
                                    // Opens on a click in this same popup, for typing at once.
                                    // eslint-disable-next-line jsx-a11y/no-autofocus
                                    autoFocus
                                    onFocus={(event) => event.currentTarget.select()}
                                    onChange={(event) =>
                                        setTipEdit({
                                            kind: 'note',
                                            query: event.target.value,
                                            index: 0,
                                        })
                                    }
                                    onKeyDown={(event) => {
                                        if (event.nativeEvent.isComposing || event.keyCode === 229)
                                            return;
                                        const count = noteChangeItems.length;
                                        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                                            event.preventDefault();
                                            if (!count) return;
                                            const step = event.key === 'ArrowDown' ? 1 : -1;
                                            setTipEdit({
                                                ...tipEdit,
                                                index: (tipEdit.index + step + count) % count,
                                            });
                                        } else if (event.key === 'Enter' && count > 0) {
                                            event.preventDefault();
                                            repointLink(
                                                linkTip,
                                                noteChangeItems[Math.min(tipEdit.index, count - 1)],
                                            );
                                        } else if (event.key === 'Escape') {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            setTipEdit(null);
                                            returnToLink(linkTip);
                                        }
                                    }}
                                    onBlur={() => setTipEdit(null)}
                                />
                                <div id="wiki-tip-options" role="listbox" aria-label="Notes">
                                    {noteChangeItems.map((item, index) => (
                                        <div
                                            key={
                                                item.kind === 'note'
                                                    ? item.note.id
                                                    : `create:${item.title}`
                                            }
                                            id={`wiki-tip-option-${index}`}
                                            role="option"
                                            aria-selected={index === tipEdit.index}
                                            className={`wiki-tip-option${
                                                index === tipEdit.index
                                                    ? ' wiki-tip-option_active'
                                                    : ''
                                            }`}
                                            onMouseDown={(event) => {
                                                // Keep focus in the field, so it doesn't blur shut.
                                                event.preventDefault();
                                                repointLink(linkTip, item);
                                            }}
                                        >
                                            <span className="wiki-tip-option-title">
                                                {item.kind === 'note'
                                                    ? item.note.title
                                                    : `Link to new note “${item.title}”`}
                                            </span>
                                            {item.kind === 'note' && dirname(item.note.id) ? (
                                                <span className="wiki-tip-option-path">
                                                    {formatCrumb(dirname(item.note.id))}
                                                </span>
                                            ) : null}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : tipEdit?.kind === 'text' ? (
                            <input
                                className="wiki-tip-input"
                                aria-label="Link text"
                                placeholder={splitWikiTarget(linkTip.inner).name}
                                value={tipEdit.value}
                                // The field opens on a click in this same popup, for typing at once.
                                // eslint-disable-next-line jsx-a11y/no-autofocus
                                autoFocus
                                onChange={(event) =>
                                    setTipEdit({kind: 'text', value: event.target.value})
                                }
                                onKeyDown={(event) => {
                                    if (event.nativeEvent.isComposing || event.keyCode === 229)
                                        return;
                                    if (event.key === 'Enter') {
                                        event.preventDefault();
                                        const {name} = splitWikiTarget(linkTip.inner);
                                        // A link's inside can hold no bracket or line break.
                                        const text = tipEdit.value.replace(/[[\]\n]/g, '').trim();
                                        setTipEdit(null);
                                        replaceWikiLink(
                                            linkTip,
                                            text && text !== name
                                                ? `[[${name}|${text}]]`
                                                : `[[${name}]]`,
                                        );
                                    } else if (event.key === 'Escape') {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        setTipEdit(null);
                                        returnToLink(linkTip);
                                    }
                                }}
                                onBlur={() => setTipEdit(null)}
                            />
                        ) : (
                            <>
                                <button
                                    type="button"
                                    className="wiki-tip-btn"
                                    onClick={() => {
                                        setLinkTip(null);
                                        onWikiLinkNavigate?.(linkTip.target);
                                    }}
                                >
                                    Open
                                </button>
                                <button
                                    type="button"
                                    className="wiki-tip-btn"
                                    onClick={() =>
                                        setTipEdit({
                                            kind: 'note',
                                            query: splitWikiTarget(linkTip.inner).name,
                                            index: 0,
                                        })
                                    }
                                >
                                    Change note
                                </button>
                                <button
                                    type="button"
                                    className="wiki-tip-btn"
                                    onClick={() =>
                                        setTipEdit({
                                            kind: 'text',
                                            value: splitWikiTarget(linkTip.inner).alias ?? '',
                                        })
                                    }
                                >
                                    Edit text
                                </button>
                                <button
                                    type="button"
                                    className="wiki-tip-btn"
                                    // The words the reader saw stay behind.
                                    onClick={() => {
                                        const {name, alias} = splitWikiTarget(linkTip.inner);
                                        replaceWikiLink(linkTip, alias ?? name);
                                    }}
                                >
                                    Unlink
                                </button>
                            </>
                        )}
                    </WikiLinkTip>
                </OverlayPortal>
            )}
            {anchorTip && !hidden && (
                <OverlayPortal>
                    <div
                        className="overlay-menu wiki-tip"
                        style={{left: anchorTip.x, top: anchorTip.y}}
                        role="toolbar"
                        aria-label={`Link to ${anchorTip.href}`}
                        // As the wiki tip: the buttons act on the link the caret is in, so a press
                        // must not move the caret out of it first.
                        onMouseDown={(event) => event.preventDefault()}
                    >
                        <span className="link-tip-href" title={anchorTip.href}>
                            {anchorTip.href}
                        </span>
                        <button
                            type="button"
                            className="wiki-tip-btn"
                            onClick={() => openHref(anchorTip.href)}
                        >
                            Open
                        </button>
                        {/* A bare URL is text: nothing to edit or unlink, it only opens. */}
                        {!anchorTip.anchor.classList.contains(URL_LINK_CLASS) && (
                            <>
                                <button
                                    type="button"
                                    className="wiki-tip-btn"
                                    onClick={() => {
                                        if (selectAnchor(anchorTip.anchor)) {
                                            setAnchorTip(null);
                                            setLinkRequest((request) => request + 1);
                                        }
                                    }}
                                >
                                    Edit
                                </button>
                                <button
                                    type="button"
                                    className="wiki-tip-btn"
                                    onClick={() => {
                                        const {anchor} = anchorTip;
                                        setAnchorTip(null);
                                        unlinkAnchor(anchor);
                                    }}
                                >
                                    Unlink
                                </button>
                            </>
                        )}
                    </div>
                </OverlayPortal>
            )}
            <SelectionToolbar
                rootRef={rootRef}
                onSync={syncRichText}
                linkRequest={linkRequest}
                hidden={hidden}
                linkOnly={toolbarShown}
            />
            {toast && (
                // `position: fixed` again — portaled for the same reason as the overlays above.
                <OverlayPortal>
                    <div className="toast" role="status" aria-live="polite">
                        {toast}
                    </div>
                </OverlayPortal>
            )}
        </div>
    );
});

export default Editor;
