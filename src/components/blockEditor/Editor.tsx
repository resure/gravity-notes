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
    KeyboardEvent,
    MouseEvent,
    PointerEvent as ReactPointerEvent,
} from 'react';

import {WIKI_LINK_CLASS, blocksToMarkdown, markdownToBlocks} from '../../markdown';
import {openExternalUrl} from '../../openExternal';
import type {NoteMeta} from '../../storage/types';
import {createWikiLinkResolver, normalizeTarget, suggestWikiTargets} from '../../wikiLinks';

import Block from './Block';
import type {BlockHandlers} from './Block';
import BlockMenu from './BlockMenu';
import {OverlayPortal} from './OverlayPortal';
import SelectionToolbar from './SelectionToolbar';
import SlashMenu from './SlashMenu';
import type {MenuAnchor} from './SlashMenu';
import {tableCellId} from './TableBlock';
import type {WikiSuggestItem} from './WikiSuggestMenu';
import WikiSuggestMenu from './WikiSuggestMenu';
import type {MenuItemDef} from './blockConfig';
import {MARKDOWN_RULES, filterMenuItems, placeholderFor} from './blockConfig';
import type {CaretPos} from './caret';
import {
    caretAtEnd,
    caretAtStart,
    caretLineRect,
    caretOnFirstLine,
    caretOnLastLine,
    deleteTextRange,
    escapeHtml,
    getCaretOffset,
    htmlToText,
    insertPlainTextAtCaret,
    isEmptyHtml,
    isSafeLinkHref,
    setCaret,
    splitHtmlAtCaret,
    stripZeroWidth,
    toggleInlineCode,
    tryInlineMarkdown,
} from './caret';
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
import {isEditableType, newBlock, newTableData, uid} from './types';
import type {BlockColor, Block as BlockData, BlockType, TableData} from './types';
import {WIKI_LINK_BROKEN_CLASS, decorateWikiLinks} from './wikiDecorate';

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

interface SelectionBox {
    left: number;
    top: number;
    width: number;
    height: number;
}

type BlocksUpdater = BlockData[] | ((blocks: BlockData[]) => BlockData[]);
type ChangeMode = 'structural' | 'input' | 'silent';

const BLOCK_TYPES = new Set<BlockType>([
    'text',
    'heading1',
    'heading2',
    'heading3',
    'todo',
    'bulleted',
    'numbered',
    'toggle',
    'table',
    'quote',
    'callout',
    'divider',
    'code',
]);
const BLOCK_COLORS = new Set<BlockColor>([
    'default',
    'gray',
    'brown',
    'orange',
    'yellow',
    'green',
    'blue',
    'purple',
    'pink',
    'red',
    'gray_background',
    'brown_background',
    'orange_background',
    'yellow_background',
    'green_background',
    'blue_background',
    'purple_background',
    'pink_background',
    'red_background',
]);

/**
 * Set on the editor root while ⌘/Ctrl is held, so CSS can switch links to a pointer cursor — the
 * same affordance the Gravity engine gives them (`g-prosemirror_mod-pressed`, see
 * `editor/openLinkExtension.ts` and `EditorPane.css`). See `.gn-block-editor_mod-pressed` in
 * `editor.css`.
 */
const MOD_PRESSED_CLASS = 'gn-block-editor_mod-pressed';

const LIST_TYPES: BlockType[] = ['bulleted', 'numbered', 'todo'];
const RESETS_ON_EMPTY_ENTER: BlockType[] = [
    'bulleted',
    'numbered',
    'todo',
    'toggle',
    'quote',
    'callout',
];

/** Same members, order-insensitive — a cheap "did the marquee's hit set actually change?" test. */
function sameIds(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) return false;
    for (const id of a) if (!b.has(id)) return false;
    return true;
}

/**
 * The only `class` values a `<span>` may keep: the editor's own style-only `[[wiki link]]` wrapper
 * (see wikiDecorate.ts). Every other span is unwrapped, so nothing outside this file can smuggle
 * styling — or, worse, structure — into a block's html.
 */
const WIKI_SPAN_CLASSES = new Set([
    WIKI_LINK_CLASS,
    `${WIKI_LINK_CLASS} ${WIKI_LINK_BROKEN_CLASS}`,
]);

function sanitizeInlineHtml(html: string): string {
    const template = document.createElement('template');
    template.innerHTML = html;
    const allowed = new Set([
        'STRONG',
        'B',
        'EM',
        'I',
        'U',
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
                if (autolink) element.setAttribute('data-autolink', '');
                element.setAttribute('rel', 'noopener noreferrer');
            }
        } else if (element.tagName === 'SPAN') {
            if (WIKI_SPAN_CLASSES.has(className)) element.setAttribute('class', className);
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
    const widestRow = source.length
        ? Math.max(...source.map((row) => (Array.isArray(row) ? row.length : 0)))
        : 1;
    const columnCount = Math.max(1, widestRow);
    const cells = source
        .filter(Array.isArray)
        .map((row) =>
            Array.from({length: columnCount}, (_, column) =>
                sanitizeInlineHtml(typeof row[column] === 'string' ? row[column] : ''),
            ),
        );
    return {
        cells: cells.length ? cells : [Array(columnCount).fill('')],
        headerRow: Boolean((value as TableData).headerRow),
        headerColumn: Boolean((value as TableData).headerColumn),
    };
}

/**
 * Put parser output through the same normalisation the editor applies to its own state. Markdown
 * reaching the editor — a note file a user (or another app) hand-edited, or a paste from anywhere —
 * is untrusted input: `markdownToBlocks` never emits markup outside the inline allowlist, and
 * `sanitizeInlineHtml` is the belt to that braces. EVERY path that turns Markdown into blocks goes
 * through here; the plain-text paste path once skipped it, which put a pasted
 * `<a href="javascript:…">` straight into the live contentEditable.
 */
function normalizeParsedBlocks(blocks: BlockData[]): BlockData[] {
    return blocks.map((block) => ({
        ...block,
        html: sanitizeInlineHtml(block.html),
        depth: Math.max(0, Math.min(6, Number(block.depth) || 0)),
        table: block.type === 'table' ? normalizeTableData(block.table) : undefined,
        color:
            typeof block.color === 'string' && BLOCK_COLORS.has(block.color as BlockColor)
                ? (block.color as BlockColor)
                : undefined,
    }));
}

/** Parse a note's Markdown into the editor's blocks (an empty note still gets one block to type in). */
function documentFromMarkdown(markdown: string, decorate: (html: string) => string): BlockData[] {
    const blocks = normalizeParsedBlocks(markdownToBlocks(markdown)).map((block) =>
        block.html ? {...block, html: decorate(block.html)} : block,
    );
    return blocks.length ? blocks : [newBlock()];
}

/** One block as Markdown — for the plain-text half of a copy. */
function blockToMarkdown(block: BlockData): string {
    return blocksToMarkdown([{...block, depth: 0}]);
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

export interface EditorHandle {
    /** Put the caret back in the body (the shell's focus ladder). */
    focus(): void;
    /** Open a fresh empty block above everything and land on it (Enter from the note title). */
    insertBlockAtTop(): void;
    /** The caret's current position, or null when focus isn't in an editable block. */
    getCaret(): EditorCaret | null;
}

export interface EditorProps {
    /** The note's Markdown body. Read ONCE, at mount: the host remounts the editor per note. */
    value: string;
    /** Focus the body on mount (a committed note); the host owns title focus. */
    autofocus?: 'body' | 'title' | null;
    /** Where to put the caret when `autofocus` is 'body' — a position saved before a note switch. */
    initialCaret?: EditorCaret | null;
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
}

const EMPTY_NOTES: NoteMeta[] = [];

const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
    {
        value,
        autofocus,
        initialCaret,
        notes = EMPTY_NOTES,
        noteId = '',
        onChange,
        onWikiLinkNavigate,
        onLeaveTop,
        onAttachFile,
        onEscape,
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
        () => (html: string) => decorateWikiLinks(html, isWikiLinkBroken),
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
        documentFromMarkdown(value, decorate),
    );
    const [toast, setToast] = useState<string | null>(null);
    const [focusedId, setFocusedId] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [slash, setSlash] = useState<SlashState | null>(null);
    const [slashIndex, setSlashIndex] = useState(0);
    const [wiki, setWiki] = useState<WikiState | null>(null);
    const [wikiIndex, setWikiIndex] = useState(0);
    const [linkRequest, setLinkRequest] = useState(0);
    const [blockMenu, setBlockMenu] = useState<{id: string; x: number; y: number} | null>(null);
    const [draggingId, setDraggingId] = useState<string | null>(null);
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
    const historyPast = useRef<HistoryEntry[]>([]);
    const historyFuture = useRef<HistoryEntry[]>([]);
    const typingGroup = useRef<{blockId: string; at: number} | null>(null);
    const selectionAnchor = useRef<string | null>(null);
    const selectionFocus = useRef<string | null>(null);
    const selectionDrag = useRef<{
        pointerId: number;
        startX: number;
        startY: number;
        base: Set<string>;
        moved: boolean;
        /** Every block's viewport rect, measured ONCE at pointerdown — see onSelectionPointerMove. */
        rects: Array<{id: string; rect: DOMRect}>;
        /** The last hit set actually pushed into state, so an unchanged drag frame is a no-op. */
        hits: Set<string>;
    } | null>(null);
    const selectionWasDragged = useRef(false);
    const toastTimer = useRef<number | null>(null);

    const blocksRef = useRef(blocks);
    blocksRef.current = blocks;
    const slashRef = useRef(slash);
    slashRef.current = slash;
    const wikiRef = useRef(wiki);
    wikiRef.current = wiki;
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

    const filteredItems = useMemo(() => filterMenuItems(slash?.query ?? ''), [slash?.query]);

    /**
     * The `[[` picker's rows. Per the spec the LAST row is always `Create "<query>"` unless the
     * query already names an existing note — which is also what keeps the popup open on a query
     * that matches nothing (the Markdown engine's picker closed there, stranding the user
     * mid-link).
     */
    const wikiItems: WikiSuggestItem[] = useMemo(() => {
        if (!wiki) return [];
        const query = wiki.query.trim();
        const matches = suggestWikiTargets(wiki.query, notesRef.current, noteIdRef.current);
        const items: WikiSuggestItem[] = matches.map((note) => ({kind: 'note', note}));
        const exact = matches.some((note) => note.title.toLowerCase() === query.toLowerCase());
        if (query !== '' && !exact) items.push({kind: 'create', title: query});
        return items;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- notes are read live; the signature is the real input
    }, [wiki?.query, wiki?.blockId, wikiSignature, noteId]);

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
            const next = typeof updater === 'function' ? updater(current) : updater;
            if (next === current) return current;
            if (mode !== 'silent') {
                const now = Date.now();
                const sameTypingGroup =
                    mode === 'input' &&
                    typingGroup.current?.blockId === inputId &&
                    now - typingGroup.current.at < 900;
                if (!sameTypingGroup) {
                    historyPast.current.push(captureHistory(current));
                    if (historyPast.current.length > 100) historyPast.current.shift();
                }
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
        setBlockState(entry.blocks);
        setSlash(null);
        setBlockMenu(null);
        setSelectedIds(new Set());
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
            let changed = false;
            const next = current.map((block) => {
                if (!block.html) return block;
                const html = decorate(block.html);
                if (html === block.html) return block;
                changed = true;
                return {...block, html};
            });
            return changed ? next : current;
        }, 'silent');
        // eslint-disable-next-line react-hooks/exhaustive-deps -- setBlocks is a stable closure over refs
    }, [decorate]);

    useImperativeHandle(ref, () => ({
        focus() {
            const target = blocksRef.current.find((block) => isEditableType(block.type));
            if (target) focusNow(target.id, 'end');
        },
        insertBlockAtTop() {
            const block = newBlock('text');
            setBlocks((current) => [block, ...current]);
            focusReq.current = {id: block.id, pos: 'start'};
        },
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
            focusNow(saved.id, initialCaret!.offset);
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

    const selectSingleBlock = (id: string) => {
        selectionAnchor.current = id;
        selectionFocus.current = id;
        setSelectedIds(new Set([id]));
    };

    const selectBlockRange = (anchorId: string, focusId: string) => {
        selectionAnchor.current = anchorId;
        selectionFocus.current = focusId;
        setSelectedIds(blockRangeIds(blocksRef.current, anchorId, focusId));
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
            const decorated = decorateRef.current(raw);
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

    const focusNow = (id: string, pos: CaretPos) => {
        const el = refs.current.get(id) ?? tableRefs.current.get(id);
        if (!el) return;
        el.focus();
        setCaret(el, pos);
    };

    /**
     * Leave the top of the body for the note title above it (ArrowUp / Backspace on the first
     * block). The title belongs to the host, so this hands off rather than focusing anything here.
     */
    const focusTitleEnd = () => {
        onLeaveTop?.();
    };

    const findEditableSibling = (id: string, dir: -1 | 1): BlockData | null => {
        const bs = blocksRef.current;
        let i = bs.findIndex((b) => b.id === id) + dir;
        while (i >= 0 && i < bs.length) {
            if (isEditableType(bs[i].type) || bs[i].type === 'table') return bs[i];
            i += dir;
        }
        return null;
    };

    const focusNavigableBlock = (block: BlockData, edge: 'start' | 'end') => {
        if (block.type !== 'table') {
            focusNow(block.id, edge);
            return;
        }
        const table = block.table ?? newTableData();
        const row = edge === 'start' ? 0 : table.cells.length - 1;
        const column = edge === 'start' ? 0 : Math.max(0, (table.cells[row]?.length ?? 1) - 1);
        focusNow(tableCellId(block.id, row, column), edge);
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
     * The app's global shortcuts (`useShortcuts`) listen on `document`, never look at
     * `defaultPrevented`, and let `mod` chords fire even while a typing surface is focused — so
     * every chord this editor also binds used to run BOTH handlers: ⌘D duplicated the block AND
     * wrote a duplicate note file into the vault, ⌘K opened the link input AND switched notes out
     * from under it, remounting the session over the half-typed link. `preventDefault` alone does
     * nothing about that (nothing downstream consults it); stopping propagation before the event
     * reaches `document` is what makes the editor's claim exclusive.
     */
    const claimChord = (e: KeyboardEvent<HTMLDivElement>) => {
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

    const openWikiMenu = (blockId: string, anchor: number) => {
        const el = refs.current.get(blockId);
        if (!el) return;
        // VIEWPORT coordinates, like every other overlay here — see openSlashMenu.
        const line = caretLineRect(el);
        setWiki({
            blockId,
            anchor,
            query: '',
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

    /** Commit a picked note (or the "Create …" row, D19: insert-only) as a literal `[[target]]`. */
    const applyWikiItem = (item: WikiSuggestItem) => {
        const state = wikiRef.current;
        if (!state) return;
        setWiki(null);
        const el = refs.current.get(state.blockId);
        if (!el) return;
        let target = item.kind === 'note' ? item.note.title : item.title;
        if (item.kind === 'note') {
            // Two notes sharing a title need the explicit `Folder/Note` form, or the link would
            // resolve by the same-folder/shallowest tiebreak rather than to the note that was
            // picked.
            const ambiguous =
                notesRef.current.filter((note) => note.title.toLowerCase() === target.toLowerCase())
                    .length > 1;
            if (ambiguous) target = item.note.id.replace(/\.md$/i, '');
        }
        deleteTextRange(el, state.anchor, getCaretOffset(el));
        if (el.innerHTML === '<br>') el.innerHTML = '';
        insertPlainTextAtCaret(`[[${target}]]`);
        commitHtml(state.blockId, el);
    };

    // ----- block operations -----

    const removeBlocks = (ids: string[]) => {
        const bs = blocksRef.current;
        const idSet = expandBlockIds(bs, ids);
        const firstIdx = bs.findIndex((b) => idSet.has(b.id));
        let remaining = bs.filter((b) => !idSet.has(b.id));
        let focusId: string | null = null;
        if (remaining.length === 0) {
            const nb = newBlock('text');
            remaining = [nb];
            focusId = nb.id;
        } else {
            for (let i = firstIdx - 1; i >= 0; i--) {
                if (!idSet.has(bs[i].id) && isEditableType(bs[i].type)) {
                    focusId = bs[i].id;
                    break;
                }
            }
            if (!focusId) focusId = remaining.find((b) => isEditableType(b.type))?.id ?? null;
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
            const last = copies[copies.length - 1];
            if (last?.type === 'table')
                focusReq.current = {id: tableCellId(last.id, 0, 0), pos: 'start'};
            else if (last && isEditableType(last.type))
                focusReq.current = {id: last.id, pos: 'end'};
        }
    };

    const turnInto = (id: string, type: BlockType) => {
        setBlocks((bs) =>
            bs.map((b) =>
                b.id === id
                    ? {
                          ...b,
                          type,
                          html:
                              type === 'divider' || type === 'table'
                                  ? ''
                                  : b.type === 'table'
                                    ? (b.table?.cells.flat().filter(Boolean).join('<br>') ?? '')
                                    : b.html,
                          table:
                              type === 'table'
                                  ? b.type === 'table'
                                      ? normalizeTableData(b.table)
                                      : newTableData(b.html)
                                  : undefined,
                          checked: undefined,
                          collapsed: undefined,
                      }
                    : b,
            ),
        );
        if (type === 'table') focusReq.current = {id: tableCellId(id, 0, 0), pos: 'end'};
        else if (type !== 'divider') focusReq.current = {id, pos: 'end'};
    };

    const moveBlock = (srcId: string, dstId: string, edge: 'before' | 'after') => {
        const next = moveBlockSubtree(blocksRef.current, srcId, dstId, edge);
        if (next !== blocksRef.current) setBlocks(next);
    };

    const changeDepth = (id: string, direction: -1 | 1) => {
        const next = changeBlockDepth(blocksRef.current, id, direction);
        if (next === blocksRef.current) return;
        setBlocks(next);
        focusReq.current = {id, pos: getCaretOffset(refs.current.get(id)!)};
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
        const block = findBlock(blockId);
        const table = block?.table ?? null;
        if (!block || !table) return;
        const cellId = tableCellId(blockId, row, column);
        const element = tableRefs.current.get(cellId);
        if (!element) return;
        const mod = e.metaKey || e.ctrlKey;

        // The same chords as `onKeyDown` below, claimed the same way \u2014 see claimChord for why
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
                    element.blur();
                    selectSingleBlock(blockId);
                }
                return;
            }
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
            element.blur();
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
            insertPlainTextAtCaret(text);
            updateTableCell(blockId, row, column, element.innerHTML);
            return;
        }
        const matrix = text
            .replace(/\r/g, '')
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
        if (sel && !sel.isCollapsed) sel.deleteFromDocument();
        const empty = isEmptyHtml(el.innerHTML);

        // Enter on an empty list/quote/callout resets it to plain text.
        if (empty && RESETS_ON_EMPTY_ENTER.includes(block.type)) {
            setBlocks((bs) =>
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
            );
            focusReq.current = {id: block.id, pos: 'start'};
            return;
        }

        // Enter at the start of a non-empty block inserts an empty line above it.
        if (!empty && caretAtStart(el)) {
            const above = {...newBlock('text'), depth: block.depth ?? 0};
            const idx = indexOf(block.id);
            setBlocks((bs) => {
                const arr = [...bs];
                arr.splice(idx, 0, above);
                return arr;
            });
            focusReq.current = {id: block.id, pos: 'start'};
            return;
        }

        const [before, after] = splitHtmlAtCaret(el);
        const continueType = LIST_TYPES.includes(block.type) ? block.type : 'text';
        const nb = {...newBlock(continueType, after), depth: block.depth ?? 0};
        const idx = indexOf(block.id);
        setBlocks((bs) => {
            const arr = bs.map((b) => (b.id === block.id ? {...b, html: before} : b));
            arr.splice(idx + 1, 0, nb);
            return arr;
        });
        focusReq.current = {id: nb.id, pos: 'start'};
    };

    const handleBackspaceAtStart = (block: BlockData, el: HTMLDivElement) => {
        // A styled block first turns back into plain text, like Notion.
        if (block.type !== 'text') {
            setBlocks((bs) =>
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
            setBlocks((bs) => bs.filter((b) => b.id !== prev.id));
            return;
        }
        if (prev.type === 'code') {
            if (isEmptyHtml(el.innerHTML)) {
                setBlocks((bs) => bs.filter((b) => b.id !== block.id));
            }
            focusReq.current = {id: prev.id, pos: 'end'};
            return;
        }
        const prevEl = refs.current.get(prev.id);
        const joinAt = (prevEl?.textContent ?? htmlToText(prev.html)).length;
        const merged = (isEmptyHtml(prev.html) ? '' : prev.html) + stripZeroWidth(el.innerHTML);
        setBlocks((bs) =>
            bs
                .filter((b) => b.id !== block.id)
                .map((b) => (b.id === prev.id ? {...b, html: merged} : b)),
        );
        focusReq.current = {id: prev.id, pos: joinAt};
    };

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>, id: string) => {
        const block = findBlock(id);
        const el = refs.current.get(id);
        if (!block || !el) return;
        if ((e.nativeEvent as unknown as {isComposing?: boolean}).isComposing) return;

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
                e.preventDefault();
                const n = wikiItems.length;
                if (n > 0)
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
                const selection = window.getSelection();
                // With nothing selected there is no link to make, so the chord is left to the app
                // (⌘K = previous note) rather than swallowed.
                if (selection && !selection.isCollapsed) {
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

        if (e.key === 'Enter') {
            if (e.shiftKey && block.type !== 'code') return; // native soft break
            e.preventDefault();
            if (block.type === 'code') {
                insertPlainTextAtCaret('\n');
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

        if (e.key === 'Tab') {
            e.preventDefault();
            if (block.type === 'code') {
                insertPlainTextAtCaret('  ');
                commitHtml(id, el);
            } else {
                changeDepth(id, e.shiftKey ? -1 : 1);
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
    const wikiLinkAt = (text: string, offset: number): string | null => {
        for (const match of text.matchAll(/\[\[([^[\]\n]+)\]\]/g)) {
            const start = match.index ?? 0;
            if (offset >= start && offset <= start + match[0].length) {
                // `|alias` and `#heading` are display/anchor sugar; the note is named by what
                // precedes them. Read through wikiLinks.ts so this surface and the resolver can
                // never disagree about what a target means.
                return normalizeTarget(match[1]) || null;
            }
        }
        return null;
    };

    const followWikiLink = (id: string, offset: number): boolean => {
        if (!onWikiLinkNavigate) return false;
        const el = refs.current.get(id);
        if (!el) return false;
        const target = wikiLinkAt(el.textContent ?? '', offset);
        if (!target) return false;
        onWikiLinkNavigate(target);
        return true;
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
        const anchor = (e.target as HTMLElement | null)?.closest('a');
        if (!anchor?.getAttribute('href')) return;
        e.preventDefault();
        if (e.metaKey || e.ctrlKey) openExternalUrl(anchor.href);
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

    // ----- input handling -----

    const onInput = (id: string) => {
        const el = refs.current.get(id);
        const block = findBlock(id);
        if (!el || !block) return;
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
    const insertImageFiles = async (afterId: string, files: File[]) => {
        if (!onAttachFile) return;
        const inserted: BlockData[] = [];
        for (const file of files) {
            const ref = await onAttachFile(file);
            if (!ref) continue;
            const image = newBlock('image');
            image.image = {src: ref, alt: file.name.replace(/\.[^.]+$/, '')};
            image.depth = findBlock(afterId)?.depth ?? 0;
            inserted.push(image);
        }
        if (!inserted.length) return;
        setBlocks((current) => {
            const at = current.findIndex((candidate) => candidate.id === afterId);
            const next = [...current];
            // An empty paragraph is replaced rather than left dangling above the image.
            const target = current[at];
            if (target && target.type === 'text' && isEmptyHtml(target.html))
                next.splice(at, 1, ...inserted);
            else next.splice(at + 1, 0, ...inserted);
            return next;
        });
    };

    const imageFilesFrom = (list: FileList | null | undefined): File[] =>
        [...(list ?? [])].filter((file) => file.type.startsWith('image/'));

    const onPaste = (e: ClipboardEvent<HTMLDivElement>, id: string) => {
        e.preventDefault();
        const el = refs.current.get(id);
        const block = findBlock(id);
        if (!el || !block) return;
        const images = imageFilesFrom(e.clipboardData.files);
        if (images.length && onAttachFile) {
            void insertImageFiles(id, images);
            return;
        }
        const serializedBlocks = e.clipboardData.getData('application/x-notion-editor-blocks');
        if (serializedBlocks) {
            try {
                const parsed = JSON.parse(serializedBlocks) as BlockData[];
                if (Array.isArray(parsed) && parsed.length > 0) {
                    const pasted = parsed
                        .filter(
                            (item) =>
                                item && BLOCK_TYPES.has(item.type) && typeof item.html === 'string',
                        )
                        .map((item) => ({
                            ...item,
                            id: uid(),
                            html: sanitizeInlineHtml(item.html),
                            depth: Math.max(0, Math.min(6, item.depth ?? 0)),
                            table:
                                item.type === 'table' ? normalizeTableData(item.table) : undefined,
                        }));
                    if (pasted.length) {
                        const idx = indexOf(id);
                        let lastInserted = pasted[pasted.length - 1];
                        if (isEmptyHtml(el.innerHTML)) {
                            const first = {...pasted.shift()!, id, depth: block.depth ?? 0};
                            lastInserted = pasted[pasted.length - 1] ?? first;
                            setBlocks((bs) => {
                                const arr = bs.map((candidate) =>
                                    candidate.id === id ? first : candidate,
                                );
                                arr.splice(idx + 1, 0, ...pasted);
                                return arr;
                            });
                        } else {
                            setBlocks((bs) => {
                                const arr = [...bs];
                                arr.splice(idx + 1, 0, ...pasted);
                                return arr;
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
        const text = e.clipboardData.getData('text/plain');
        if (!text) return;

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

        if (block.type === 'code' || !text.includes('\n')) {
            insertPlainTextAtCaret(text);
            commitHtml(id, el);
            return;
        }

        const lines = text.replace(/\r/g, '').split('\n');
        const [beforeHtml, afterHtml] = splitHtmlAtCaret(el);
        const first = lines.shift() ?? '';
        // Pasted text is read as Markdown, by the same parser that loads a note — so a pasted list,
        // heading, or table arrives as real blocks rather than as literal syntax. Same sanitising
        // pass as the load path: the clipboard is as untrusted as a file.
        const rest = normalizeParsedBlocks(markdownToBlocks(lines.join('\n'))).map((parsed) => ({
            ...parsed,
            depth: (block.depth ?? 0) + (parsed.depth ?? 0),
        }));
        const lastBlock = rest[rest.length - 1];
        let caretTarget: {id: string; pos: CaretPos} = {id, pos: 'end'};
        if (lastBlock && isEditableType(lastBlock.type)) {
            const lastLen = htmlToText(lastBlock.html).length;
            lastBlock.html += afterHtml;
            caretTarget = {id: lastBlock.id, pos: lastLen};
        }
        const idx = indexOf(id);
        setBlocks((bs) => {
            const arr = bs.map((b) =>
                b.id === id ? {...b, html: beforeHtml + escapeHtml(first)} : b,
            );
            arr.splice(idx + 1, 0, ...rest);
            return arr;
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
     * The editor's own overlays count as inside it even though they are portaled out to `<body>`
     * (they carry the scope class) — the block menu advertises Del and ⌘D, and those act on the
     * selection while it is open. A text field within one of them still wins, though: whatever is
     * being typed into owns its own keys.
     */
    const ownsDocumentEvent = (target: EventTarget | null): boolean => {
        if (!(target instanceof HTMLElement)) return true; // document-level: nothing else focused
        if (target === document.body || target === document.documentElement) return true;
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
        if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            const selectedIndexes = blocksRef.current
                .map((block, index) => (selected.has(block.id) ? index : -1))
                .filter((index) => index >= 0);
            if (!selectedIndexes.length) return;
            const fallback =
                e.key === 'ArrowUp' ? Math.min(...selectedIndexes) : Math.max(...selectedIndexes);
            const focusId = selectionFocus.current ?? blocksRef.current[fallback]?.id;
            const focusIndex = focusId
                ? blocksRef.current.findIndex((block) => block.id === focusId)
                : fallback;
            const nextIndex = Math.max(
                0,
                Math.min(blocksRef.current.length - 1, focusIndex + (e.key === 'ArrowUp' ? -1 : 1)),
            );
            const anchorId = selectionAnchor.current ?? blocksRef.current[fallback].id;
            selectBlockRange(anchorId, blocksRef.current[nextIndex].id);
        } else if (e.key === 'Backspace' || e.key === 'Delete') {
            e.preventDefault();
            removeBlocks([...selected]);
        } else if (e.key === 'Escape') {
            clearBlockSelection();
            // Nothing left in the editor to dismiss: the shell walks focus back to the note list.
            onEscape?.();
        } else if (mod && e.key.toLowerCase() === 'd') {
            e.preventDefault();
            duplicateBlocks([...selected], true);
        } else if (mod && e.key.toLowerCase() === 'a') {
            e.preventDefault();
            selectionAnchor.current = blocksRef.current[0]?.id ?? null;
            selectionFocus.current = blocksRef.current[blocksRef.current.length - 1]?.id ?? null;
            setSelectedIds(new Set(blocksRef.current.map((b) => b.id)));
        } else if (mod && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            restoreHistory(e.shiftKey ? 'redo' : 'undo');
        }
    };

    const onSelectionClipboard = (e: globalThis.ClipboardEvent) => {
        if (!ownsDocumentEvent(e.target)) return;
        const expanded = expandBlockIds(blocksRef.current, selectedIdsRef.current);
        const selected = blocksRef.current.filter((block) => expanded.has(block.id));
        if (!selected.length) return;
        e.preventDefault();
        e.clipboardData?.setData('application/x-notion-editor-blocks', JSON.stringify(selected));
        e.clipboardData?.setData('text/plain', selected.map(blockToMarkdown).join('\n'));
        if (e.type === 'cut') {
            showToast(`Cut ${selected.length} ${selected.length === 1 ? 'block' : 'blocks'}`);
            removeBlocks(selected.map((block) => block.id));
        } else {
            showToast(`Copied ${selected.length} ${selected.length === 1 ? 'block' : 'blocks'}`);
        }
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
        document.addEventListener('keydown', onKey);
        document.addEventListener('mousedown', onMouseDown);
        document.addEventListener('copy', onClipboard);
        document.addEventListener('cut', onClipboard);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('copy', onClipboard);
            document.removeEventListener('cut', onClipboard);
        };
    }, [hasBlockSelection]);

    // ----- drag & drop -----

    const onDragStart = (e: DragEvent<HTMLButtonElement>, id: string) => {
        e.dataTransfer.setData('text/plain', id);
        e.dataTransfer.effectAllowed = 'move';
        const blockEl = (e.currentTarget as HTMLElement).closest('.block');
        if (blockEl) e.dataTransfer.setDragImage(blockEl, 20, 10);
        // Defer: mutating the DOM inside dragstart cancels the drag in Chrome.
        setTimeout(() => setDraggingId(id), 0);
    };

    const onDragOver = (e: DragEvent<HTMLDivElement>, id: string) => {
        if (!draggingId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const edge = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
        setDropTarget((t) => (t && t.id === id && t.edge === edge ? t : {id, edge}));
    };

    const onDrop = (e: DragEvent<HTMLDivElement>, id: string) => {
        e.preventDefault();
        const images = imageFilesFrom(e.dataTransfer.files);
        if (images.length && onAttachFile) {
            setDraggingId(null);
            setDropTarget(null);
            void insertImageFiles(id, images);
            return;
        }
        const src = draggingId ?? e.dataTransfer.getData('text/plain');
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const edge = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
        setDraggingId(null);
        setDropTarget(null);
        if (src) moveBlock(src, id, edge);
    };

    const onDragEnd = () => {
        setDraggingId(null);
        setDropTarget(null);
    };

    // ----- hover controls -----

    const onPlusClick = (_e: MouseEvent<HTMLButtonElement>, id: string) => {
        const block = findBlock(id);
        if (!block) return;
        if (block.type === 'text' && isEmptyHtml(block.html)) {
            focusNow(id, 'start');
            const el = refs.current.get(id);
            openSlashMenu(id, el ? getCaretOffset(el) : 0, 0);
            return;
        }
        const nb = {...newBlock('text'), depth: block.depth ?? 0};
        const idx = indexOf(id);
        setBlocks((bs) => {
            const arr = [...bs];
            arr.splice(idx + 1, 0, nb);
            return arr;
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
            // Measure every block ONCE, here. Nothing re-lays the document out while a marquee is
            // being dragged (the drawn rectangle assumes the same), so re-reading N
            // getBoundingClientRect()s on every pointermove only bought a forced layout per frame.
            rects: [...(rootRef.current?.querySelectorAll<HTMLElement>('.block') ?? [])].map(
                (element) => ({id: element.id, rect: element.getBoundingClientRect()}),
            ),
            hits: new Set(base),
        };
        selectionWasDragged.current = false;
        if (!(e.metaKey || e.ctrlKey)) clearBlockSelection();
    };

    const onSelectionPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
        const drag = selectionDrag.current;
        if (!drag || drag.pointerId !== e.pointerId) return;
        const distance = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
        if (!drag.moved && distance < 4) return;
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

        const edge = 48;
        if (e.clientY < edge) window.scrollBy({top: -12, behavior: 'auto'});
        else if (e.clientY > window.innerHeight - edge)
            window.scrollBy({top: 12, behavior: 'auto'});
    };

    const finishSelectionPointer = (e: ReactPointerEvent<HTMLElement>) => {
        const drag = selectionDrag.current;
        if (!drag || drag.pointerId !== e.pointerId) return;
        if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        selectionDrag.current = null;
        setSelectionBox(null);
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

    const numbers = new Map<string, number>();
    {
        const counters = new Map<number, number>();
        for (const b of blocks) {
            const depth = b.depth ?? 0;
            if (b.type === 'numbered') {
                for (const key of [...counters.keys()]) if (key > depth) counters.delete(key);
                const n = (counters.get(depth) ?? 0) + 1;
                counters.set(depth, n);
                numbers.set(b.id, n);
            } else {
                for (const key of [...counters.keys()]) if (key >= depth) counters.delete(key);
            }
        }
    }

    const visibleIds = new Set<string>();
    {
        let collapsedDepth: number | null = null;
        for (const block of blocks) {
            const depth = block.depth ?? 0;
            if (collapsedDepth !== null && depth > collapsedDepth) continue;
            collapsedDepth = null;
            visibleIds.add(block.id);
            if (block.type === 'toggle' && block.collapsed) collapsedDepth = depth;
        }
    }

    const nextHandlers: BlockHandlers = {
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
        onFocus: (id) => setFocusedId(id),
        onBlur: (id) => setFocusedId((cur) => (cur === id ? null : cur)),
        onToggleTodo: (id) =>
            setBlocks((bs) => bs.map((b) => (b.id === id ? {...b, checked: !b.checked} : b))),
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
        onTableToggleHeaderColumn: (id) =>
            updateTable(id, (table) => ({...table, headerColumn: !table.headerColumn})),
        onContentMouseDown,
        onSelectBlock: selectSingleBlock,
        onPlusClick,
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
        <div className="gn-block-editor" ref={rootRef} onClick={onRootClick}>
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
                                listNumber={numbers.get(b.id) ?? 1}
                                selected={selectedIds.has(b.id)}
                                dragging={draggingId === b.id}
                                dropEdge={dropTarget?.id === b.id ? dropTarget.edge : null}
                                placeholder={placeholderFor(
                                    b,
                                    focusedId === b.id,
                                    blocks.length === 1,
                                )}
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

            {slash && (
                <SlashMenu
                    anchor={slash.rect}
                    items={filteredItems}
                    activeIndex={slashIndex}
                    onHover={setSlashIndex}
                    onSelect={applySlashItem}
                    onClose={() => setSlash(null)}
                />
            )}
            {wiki && wikiItems.length > 0 && (
                <WikiSuggestMenu
                    anchor={wiki.rect}
                    items={wikiItems}
                    activeIndex={Math.min(wikiIndex, wikiItems.length - 1)}
                    onHover={setWikiIndex}
                    onSelect={applyWikiItem}
                    onClose={() => setWiki(null)}
                />
            )}
            {blockMenu && menuBlock && (
                <BlockMenu
                    x={blockMenu.x}
                    y={blockMenu.y}
                    currentType={menuBlock.type}
                    currentColor={menuBlock.color}
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
                                ids.has(block.id)
                                    ? {...block, color: color === 'default' ? undefined : color}
                                    : block,
                            ),
                        );
                        setBlockMenu(null);
                    }}
                    onClose={() => setBlockMenu(null)}
                />
            )}
            <SelectionToolbar rootRef={rootRef} onSync={syncRichText} linkRequest={linkRequest} />
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
