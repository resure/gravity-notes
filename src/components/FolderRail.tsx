import {
    Fragment,
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from 'react';
import type {DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent} from 'react';

import {basename, dirname, joinPath, sanitizeSegment} from '../storage/noteText';
import type {FolderRow} from '../tree';
import {Button} from '../ui/Button';
import {Menu, MenuItem, MenuSeparator} from '../ui/Menu';
import {Tooltip} from '../ui/Tooltip';
import {
    ChevronDown,
    ChevronRight,
    Ellipsis,
    Folder,
    FolderOpen,
    FolderPlus,
    Layers,
    Pencil,
    Pin,
    PinFill,
    PinSlash,
    Plus,
    Trash,
} from '../ui/icons';

import './FolderRail.css';

/** Row key for the special "All Notes" entry (folder paths are always non-empty). */
const ALL_KEY = ' all';
/** dataTransfer type carrying a dragged folder's path (notes use `NOTE_MIME`, so the two differ). */
const FOLDER_MIME = 'application/x-gravity-folder';
/**
 * dataTransfer type carrying a dragged note's id — gates note drops so foreign `text/plain` drags
 * (arbitrary external text) can't be passed into `onMoveTo`. Must match `NOTE_MIME` in NoteList.
 */
const NOTE_MIME = 'application/x-gravity-note';

export interface FolderRailHandle {
    /** Move keyboard focus to the selected rail row (or All Notes). */
    focusSelected(): void;
    /** Begin inline-renaming a folder (the global F2 shortcut, when a folder row is focused). */
    startRename(path: string): void;
    /** Move the folder selection by `delta` rows (the global ⌘J/⌘K, when the rail is focused). */
    selectRelative(delta: number): void;
}

export interface FolderRailProps {
    /** The folder tree (folders only — notes live in the middle pane). */
    rows: FolderRow[];
    /** The selected folder path, or null for "All Notes". */
    selectedFolder: string | null;
    /** Count for the "All Notes" badge. */
    allNotesCount: number;
    /** Select a folder (null = All Notes); the middle pane re-scopes to it. */
    onSelectFolder: (folder: string | null) => void;
    /** Expand / collapse a folder's subfolders. */
    onToggleCollapse: (path: string) => void;
    /** Create an (initially empty) folder under `parentPath` (`''` = root). */
    onCreateFolder: (parentPath: string, name: string) => void;
    /** Remove an empty folder (no notes anywhere under it, no subfolders). */
    onRemoveFolder: (path: string) => void;
    /**
     * Move / rename a folder (re-keying its whole subtree). May resolve `false` on a rejected move
     * (name collision / no-op), which lets the rail clear its pending select-after-refresh.
     */
    onMoveFolder: (fromPath: string, toPath: string) => void | Promise<boolean>;
    /** Toggle a folder's pin. */
    onTogglePin: (path: string) => void;
    /** Move a dropped note into a folder (`''` = root). */
    onMoveTo: (noteId: string, destFolder: string) => void;
    /** Reveal a folder in Finder — present only on the native desktop backend (else hidden). */
    onReveal?: (path: string) => void;
    /** Move focus into the notes list (Enter / → off a leaf folder). */
    onFocusList: () => void;
    /** The Trash, at the rail's foot — a destination, not a folder (§04). */
    trashCount: number;
    onOpenTrash: () => void;
}

/** Whether dropping the dragged folder onto `target` (`''` = root) is forbidden (self / descendant). */
function isInvalidFolderDrop(target: string, dragged: string): boolean {
    return target === dragged || target.startsWith(`${dragged}/`);
}

/**
 * The 236px folder rail (§04).
 *
 * Its rows are the same 14/500 type as the note list, so the two panes read as one app, and the
 * column is grouped by two mono labels — Library and Folders — exactly the way the note list groups
 * by time. Indent is a 12px step with a hairline guide, which is what keeps five levels legible in a
 * 236px column.
 *
 * It stays a plain roving-tabindex tree and NOT a Base UI Menu, deliberately: Menu and Select
 * capture single letters for type-to-select, which would eat `n` (new subfolder) and the vim `j`/`k`
 * the rail navigates with.
 */
export const FolderRail = forwardRef<FolderRailHandle, FolderRailProps>(function FolderRail(
    {
        rows,
        selectedFolder,
        allNotesCount,
        onSelectFolder,
        onToggleCollapse,
        onCreateFolder,
        onRemoveFolder,
        onMoveFolder,
        onTogglePin,
        onMoveTo,
        onReveal,
        onFocusList,
        trashCount,
        onOpenTrash,
    },
    ref,
) {
    // The parent path for a pending New-folder editor (null = closed); '' = create at the root.
    const [newFolderParent, setNewFolderParent] = useState<string | null>(null);
    const [newFolderName, setNewFolderName] = useState('');
    // The folder being inline-renamed (null = none).
    const [renaming, setRenaming] = useState<{path: string; value: string} | null>(null);
    // The folder/All-Notes row a drag is hovering (the key), and the folder currently being dragged.
    const [dropTarget, setDropTarget] = useState<string | null>(null);
    const [draggingFolder, setDraggingFolder] = useState<string | null>(null);
    // The folder + anchor for the one open action menu (null = closed). A single shared menu serves
    // both each row's ⋯ button and the right-click context menu, so the rail mounts no per-row Menu
    // (a popup instance + its rebuilt items array per folder row is needless work). The anchor is
    // either the ⋯ button or a zero-size rect at the cursor.
    const [contextMenu, setContextMenu] = useState<{
        row: FolderRow;
        anchor: HTMLElement | {getBoundingClientRect: () => DOMRect};
    } | null>(null);
    const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const newFolderInputRef = useRef<HTMLInputElement>(null);
    const renameInputRef = useRef<HTMLInputElement>(null);

    // Edge autoscroll: while a drag hovers near the top/bottom of the scroll area, keep scrolling so
    // off-screen folders are reachable. A rAF loop runs while `scrollDirRef` is non-zero.
    const itemsRef = useRef<HTMLDivElement>(null);
    const scrollDirRef = useRef(0);
    const rafRef = useRef<number | null>(null);
    // The window-level dragend/drop safety net (null = not registered). A note dragged in from the
    // list and aborted with Escape never fires the rail's own onDragEnd, so without this the rAF
    // loop would keep scrolling forever.
    const endListenerRef = useRef<(() => void) | null>(null);
    const stepAutoScroll = useCallback(() => {
        const el = itemsRef.current;
        if (!el || scrollDirRef.current === 0) {
            rafRef.current = null;
            return;
        }
        el.scrollTop += scrollDirRef.current * 8;
        rafRef.current = requestAnimationFrame(stepAutoScroll);
    }, []);
    const stopAutoScroll = useCallback(() => {
        scrollDirRef.current = 0;
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        if (endListenerRef.current) {
            window.removeEventListener('dragend', endListenerRef.current);
            window.removeEventListener('drop', endListenerRef.current);
            endListenerRef.current = null;
        }
    }, []);
    const updateAutoScroll = useCallback(
        (clientY: number) => {
            const el = itemsRef.current;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const EDGE = 28;
            let dir = 0;
            if (clientY < rect.top + EDGE) dir = -1;
            else if (clientY > rect.bottom - EDGE) dir = 1;
            scrollDirRef.current = dir;
            if (dir !== 0 && rafRef.current === null) {
                rafRef.current = requestAnimationFrame(stepAutoScroll);
            }
            // Catch a drag that ends anywhere (incl. an Escape-aborted note drag from the list, which
            // never reaches a rail handler) so the loop is always torn down.
            if (dir !== 0 && endListenerRef.current === null) {
                const onEnd = () => stopAutoScroll();
                endListenerRef.current = onEnd;
                window.addEventListener('dragend', onEnd);
                window.addEventListener('drop', onEnd);
            }
        },
        [stepAutoScroll, stopAutoScroll],
    );
    useEffect(() => stopAutoScroll, [stopAutoScroll]);

    // The flat keyboard order: All Notes, then each visible folder row.
    const navItems = useMemo<{key: string; folder: string | null; row?: FolderRow}[]>(
        () => [
            {key: ALL_KEY, folder: null},
            ...rows.map((row) => ({key: row.path, folder: row.path, row})),
        ],
        [rows],
    );
    const selectedKey = selectedFolder === null ? ALL_KEY : selectedFolder;
    // The tabbable row: the selected one if it's visible, else fall back to All Notes.
    const focusableKey = navItems.some((i) => i.key === selectedKey) ? selectedKey : ALL_KEY;

    useEffect(() => {
        if (newFolderParent !== null) newFolderInputRef.current?.focus();
    }, [newFolderParent]);
    // Select the whole name when a rename BEGINS — keyed on the path, not on `renaming` itself:
    // every keystroke mints a new state object, and re-running this would re-select the text under
    // the caret on each character (typing "Wonk" would leave "k").
    const renamingPath = renaming?.path;
    useEffect(() => {
        if (renamingPath !== undefined) renameInputRef.current?.select();
    }, [renamingPath]);

    const focusRow = useCallback((key: string) => itemRefs.current.get(key)?.focus(), []);

    const select = useCallback(
        (item: {key: string; folder: string | null}) => {
            onSelectFolder(item.folder);
            focusRow(item.key);
        },
        [onSelectFolder, focusRow],
    );

    // After a rename/reparent re-keys the subtree, the new row only appears once the move resolves and
    // the tree refreshes. Remember the destination and, when it shows up, select + focus it — so the
    // folder you just renamed stays put under the cursor instead of the focus dropping to the body.
    const pendingRenameToRef = useRef<string | null>(null);
    useEffect(() => {
        const to = pendingRenameToRef.current;
        if (to === null || !navItems.some((i) => i.key === to)) return;
        pendingRenameToRef.current = null;
        // Already the selected folder (you renamed the one you were in): just restore focus, so its
        // open note isn't re-previewed. Otherwise select it (scopes the list) and focus it.
        if (selectedKey === to) focusRow(to);
        else select({key: to, folder: to});
    }, [navItems, selectedKey, select, focusRow]);

    useImperativeHandle(
        ref,
        () => ({
            focusSelected() {
                focusRow(focusableKey);
            },
            startRename(path: string) {
                setRenaming({path, value: basename(path)});
            },
            selectRelative(delta: number) {
                const index = navItems.findIndex((i) => i.key === selectedKey);
                // Nothing selected yet: a step down starts at the top, a step up at the bottom.
                let from = index;
                if (index === -1) from = delta > 0 ? -1 : navItems.length;
                const next = navItems[from + delta];
                if (next) select(next);
            },
        }),
        // navItems/selectedKey are recomputed each render, so the handle always sees the live tree.
        [focusableKey, navItems, selectedKey, select, focusRow],
    );

    const submitNewFolder = () => {
        const name = newFolderName.trim();
        const parent = newFolderParent;
        setNewFolderParent(null);
        setNewFolderName('');
        if (parent !== null && name) onCreateFolder(parent, name);
    };

    // Blur on the new-folder editor cancels (unlike rename-on-blur): clicking away shouldn't create
    // a half-typed folder. Creation commits only on Enter.
    const cancelNewFolder = () => {
        setNewFolderParent(null);
        setNewFolderName('');
    };

    // Begin a new subfolder under `row`: expand it first (if collapsed) so the editor — and the
    // folder once created — are visible beneath their parent rather than hidden.
    const startNewSubfolder = (row: FolderRow) => {
        if (row.collapsed) onToggleCollapse(row.path);
        setNewFolderParent(row.path);
    };

    const submitRename = () => {
        const current = renaming;
        setRenaming(null);
        if (!current) return;
        const leaf = sanitizeSegment(current.value.trim());
        const next = joinPath(dirname(current.path), leaf);
        if (current.value.trim() && next !== current.path) {
            // Only remember the destination to select + focus once the move *succeeds*. Setting it
            // up-front would dangle on a rejected move (name collision) and later hijack focus for an
            // unrelated folder created at that path. Promise-returning backends clear it on `false`.
            const result = onMoveFolder(current.path, next);
            if (result && typeof result.then === 'function') {
                void result.then((moved) => {
                    if (moved) pendingRenameToRef.current = next;
                });
            } else {
                // Synchronous (void) handler: optimistically follow it, as before.
                pendingRenameToRef.current = next;
            }
        }
    };

    // ← behavior: collapse an expanded folder, else step up to (and select) its parent.
    const collapseOrSelectParent = (row?: FolderRow) => {
        if (!row) return;
        if (row.hasChildren && !row.collapsed) {
            onToggleCollapse(row.path);
        } else if (row.path.includes('/')) {
            const parent = row.path.slice(0, row.path.lastIndexOf('/'));
            select({key: parent, folder: parent});
        }
    };

    // →/←/Enter over a focused row.
    const onHorizontalKey = (
        event: ReactKeyboardEvent<HTMLDivElement>,
        row: FolderRow | undefined,
        bare: boolean,
    ) => {
        if (event.key === 'ArrowRight') {
            event.preventDefault();
            if (row && row.hasChildren && row.collapsed) onToggleCollapse(row.path);
            else onFocusList();
        } else if (event.key === 'ArrowLeft') {
            event.preventDefault();
            collapseOrSelectParent(row);
        } else if (bare && event.key === 'Enter') {
            event.preventDefault();
            // Enter reveals/conceals a folder with subfolders; a leaf folder (nothing to toggle)
            // dives into its notes instead.
            if (row && row.hasChildren) onToggleCollapse(row.path);
            else onFocusList();
        }
    };

    // n / Backspace|Delete over a focused row: new (sub)folder, or remove an empty one. `row` is
    // undefined for the All Notes row, where `n` makes a root folder.
    const onActionKey = (event: ReactKeyboardEvent<HTMLDivElement>, row: FolderRow | undefined) => {
        if (event.key === 'n') {
            event.preventDefault();
            if (row) startNewSubfolder(row);
            else setNewFolderParent(''); // All Notes → a new root folder
        } else if ((event.key === 'Backspace' || event.key === 'Delete') && row) {
            event.preventDefault();
            if (row.noteCount === 0 && !row.hasChildren) onRemoveFolder(row.path);
        }
    };

    const onRowKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, key: string) => {
        const index = navItems.findIndex((i) => i.key === key);
        if (index === -1) return;
        const {row} = navItems[index];
        // Bare keys (no ⌘/⌃/⌥) so ⌘J/⌘K and ⌘↵ still reach the global handler.
        const bare = !event.metaKey && !event.ctrlKey && !event.altKey;
        // Vertical move: arrows or vim j/k → select the neighbor row.
        let delta = 0;
        if (event.key === 'ArrowDown' || (bare && event.key === 'j')) delta = 1;
        else if (event.key === 'ArrowUp' || (bare && event.key === 'k')) delta = -1;
        if (delta !== 0) {
            event.preventDefault();
            const next = navItems[index + delta];
            if (next) select(next);
            return;
        }
        if (bare && (event.key === 'n' || event.key === 'Backspace' || event.key === 'Delete')) {
            onActionKey(event, row);
            return;
        }
        onHorizontalKey(event, row, bare);
    };

    /** Drag a note or folder over a target row (`target` = folder path, `''` = root). */
    const onRowDragOver = (event: ReactDragEvent, key: string, target: string) => {
        if (draggingFolder) {
            // A folder drag onto itself / a descendant is forbidden; so is its own current parent —
            // the reparent there is a guaranteed no-op, so don't light the row up for it.
            if (isInvalidFolderDrop(target, draggingFolder)) return;
            if (joinPath(target, basename(draggingFolder)) === draggingFolder) return;
        }
        event.preventDefault();
        if (dropTarget !== key) setDropTarget(key);
    };

    /** Drop a note (→ move into folder) or a folder (→ reparent/rename) onto `target`. */
    const onRowDrop = (event: ReactDragEvent, target: string) => {
        event.preventDefault();
        setDropTarget(null);
        stopAutoScroll();
        const folderPath = draggingFolder ?? event.dataTransfer.getData(FOLDER_MIME);
        if (folderPath) {
            if (isInvalidFolderDrop(target, folderPath)) return;
            const next = joinPath(target, basename(folderPath));
            if (next !== folderPath) onMoveFolder(folderPath, next);
            return;
        }
        // Require our own MIME, so a foreign drag (arbitrary text/plain from outside the app) can't
        // be passed into onMoveTo as if it were a note id.
        const id = event.dataTransfer.getData(NOTE_MIME);
        if (id) onMoveTo(id, target);
    };

    /**
     * The indent guides for a row at `depth`: one 12px column per ancestor level, each drawing the
     * hairline that keeps a deep tree legible in a 236px column.
     */
    const renderGuides = (depth: number) =>
        depth > 0 ? (
            <span className="folder-rail__guides" aria-hidden>
                {Array.from({length: depth}, (_, level) => (
                    <span key={level} className="folder-rail__guide" />
                ))}
            </span>
        ) : null;

    const renderAllNotes = () => {
        const selected = selectedFolder === null;
        return (
            <div
                key={ALL_KEY}
                ref={(el) => {
                    if (el) itemRefs.current.set(ALL_KEY, el);
                    else itemRefs.current.delete(ALL_KEY);
                }}
                className={
                    'folder-rail__row' +
                    (selected ? ' folder-rail__row_selected' : '') +
                    (dropTarget === ALL_KEY ? ' folder-rail__row_drop-target' : '')
                }
                role="treeitem"
                aria-level={1}
                aria-selected={selected}
                tabIndex={focusableKey === ALL_KEY ? 0 : -1}
                onClick={() => select({key: ALL_KEY, folder: null})}
                onKeyDown={(e) => onRowKeyDown(e, ALL_KEY)}
                onDragOver={(e) => onRowDragOver(e, ALL_KEY, '')}
                onDragLeave={() => setDropTarget((t) => (t === ALL_KEY ? null : t))}
                onDrop={(e) => onRowDrop(e, '')}
            >
                <span className="folder-rail__caret" />
                <Layers size={15} className="folder-rail__icon" />
                <span className="folder-rail__name">All Notes</span>
                {allNotesCount > 0 ? (
                    <span className="folder-rail__count">{allNotesCount}</span>
                ) : null}
            </div>
        );
    };

    /** The shared inline editor for both renaming a folder and naming a new one. */
    const renderFolderInput = (
        depth: number,
        value: string,
        onChange: (value: string) => void,
        onSubmit: () => void,
        onCancel: () => void,
        inputRef: typeof renameInputRef,
        placeholder?: string,
    ) => (
        // A treeitem like the row it stands in for: it sits inside `role="tree"`, which owns only
        // treeitem / group children.
        <div
            className="folder-rail__row folder-rail__row_editing"
            role="treeitem"
            aria-level={depth + 1}
            aria-selected={false}
        >
            {renderGuides(depth)}
            <span className="folder-rail__caret" />
            <Folder size={15} className="folder-rail__icon" />
            <input
                ref={inputRef}
                className="folder-rail__input"
                value={value}
                placeholder={placeholder}
                aria-label={placeholder ?? 'Folder name'}
                onChange={(e) => onChange(e.target.value)}
                onBlur={onSubmit}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        onSubmit();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        onCancel();
                    }
                }}
            />
        </div>
    );

    const renderFolder = (row: FolderRow) => {
        if (renaming?.path === row.path) {
            return (
                <Fragment key={row.path}>
                    {renderFolderInput(
                        row.depth,
                        renaming.value,
                        (value) => setRenaming((r) => (r ? {...r, value} : r)),
                        submitRename,
                        () => setRenaming(null),
                        renameInputRef,
                    )}
                </Fragment>
            );
        }
        const selected = selectedFolder === row.path;
        return (
            <div
                key={row.path}
                data-path={row.path}
                ref={(el) => {
                    if (el) itemRefs.current.set(row.path, el);
                    else itemRefs.current.delete(row.path);
                }}
                className={
                    'folder-rail__row' +
                    (selected ? ' folder-rail__row_selected' : '') +
                    (dropTarget === row.path ? ' folder-rail__row_drop-target' : '')
                }
                role="treeitem"
                aria-level={row.depth + 1}
                aria-selected={selected}
                aria-expanded={row.hasChildren ? !row.collapsed : undefined}
                tabIndex={focusableKey === row.path ? 0 : -1}
                draggable
                onDragStart={(e) => {
                    e.dataTransfer.setData(FOLDER_MIME, row.path);
                    // eslint-disable-next-line no-param-reassign -- standard DnD idiom: set the drag effect
                    e.dataTransfer.effectAllowed = 'move';
                    setDraggingFolder(row.path);
                }}
                onDragEnd={() => {
                    setDraggingFolder(null);
                    setDropTarget(null);
                    stopAutoScroll();
                }}
                onClick={() => select({key: row.path, folder: row.path})}
                onContextMenu={(e) => {
                    e.preventDefault();
                    select({key: row.path, folder: row.path});
                    const {clientX, clientY} = e;
                    setContextMenu({
                        row,
                        anchor: {getBoundingClientRect: () => new DOMRect(clientX, clientY, 0, 0)},
                    });
                }}
                onDoubleClick={() => setRenaming({path: row.path, value: row.name})}
                onKeyDown={(e) => onRowKeyDown(e, row.path)}
                onDragOver={(e) => onRowDragOver(e, row.path, row.path)}
                onDragLeave={() => setDropTarget((t) => (t === row.path ? null : t))}
                onDrop={(e) => onRowDrop(e, row.path)}
            >
                {renderGuides(row.depth)}
                {row.hasChildren ? (
                    <button
                        type="button"
                        className="folder-rail__caret folder-rail__caret_button"
                        aria-label={`${row.collapsed ? 'Expand' : 'Collapse'} ${row.name}`}
                        tabIndex={-1}
                        onClick={(e) => {
                            e.stopPropagation(); // toggle only — don't also select
                            onToggleCollapse(row.path);
                        }}
                    >
                        {row.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    </button>
                ) : (
                    <span className="folder-rail__caret" />
                )}
                <Folder size={15} className="folder-rail__icon" />
                <span className="folder-rail__name">{row.name}</span>
                {row.pinned ? <PinFill size={12} className="folder-rail__pin" /> : null}
                {row.noteCount > 0 ? (
                    <span className="folder-rail__count">{row.noteCount}</span>
                ) : null}
                <div className="folder-rail__actions">
                    <Button
                        size="s"
                        icon={<Ellipsis size={15} />}
                        tabIndex={-1}
                        aria-label={`${row.name} actions`}
                        onClick={(e) => {
                            // Open the one shared menu anchored to this button — don't also select
                            // the row (toggle off if it's already this row's menu).
                            e.stopPropagation();
                            const target = e.currentTarget;
                            setContextMenu((open) =>
                                open?.row.path === row.path ? null : {row, anchor: target},
                            );
                        }}
                    />
                </div>
            </div>
        );
    };

    // The inline new-folder editor, indented to its parent's child depth ('' root = depth 0).
    const renderNewFolderInput = () =>
        renderFolderInput(
            newFolderParent ? newFolderParent.split('/').length : 0,
            newFolderName,
            setNewFolderName,
            submitNewFolder,
            cancelNewFolder,
            newFolderInputRef,
            'Folder name',
        );

    const menuRow = contextMenu?.row;
    const deletable = menuRow ? menuRow.noteCount === 0 && !menuRow.hasChildren : false;

    return (
        // Drag autoscroll lives on the wrapper (not the role="tree" list) so the tree stays
        // non-interactive; the rAF loop scrolls the inner items container via itemsRef.
        <div
            className="folder-rail"
            onDragOver={(e) => updateAutoScroll(e.clientY)}
            onDrop={stopAutoScroll}
            onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) stopAutoScroll();
            }}
        >
            <div ref={itemsRef} className="folder-rail__items">
                {/* Two mono labels group the column the way the note list groups by time. */}
                <div className="folder-rail__group-label">Library</div>
                <div role="tree" aria-label="Folders">
                    {renderAllNotes()}
                    {/* Decoration, not a node of the tree — `role="tree"` may own only treeitem /
                        group children, and a bare div inside one is announced as an unnamed item. */}
                    <div
                        className="folder-rail__group-label folder-rail__group-label_spaced"
                        role="presentation"
                    >
                        Folders
                    </div>
                    {/* A new root folder sits at the top; a new subfolder renders under its parent. */}
                    {newFolderParent === '' ? renderNewFolderInput() : null}
                    {rows.map((row) => (
                        <Fragment key={row.path}>
                            {renderFolder(row)}
                            {newFolderParent === row.path ? renderNewFolderInput() : null}
                        </Fragment>
                    ))}
                </div>
                {/* First-run nudge: no folders yet, and not already typing a new one. */}
                {rows.length === 0 && newFolderParent === null ? (
                    <div className="folder-rail__hint">
                        No folders yet. Add one to group your notes.
                    </div>
                ) : null}

                <div className="folder-rail__spacer" />

                {/* Trash sits at the foot, away from the vault: it is a destination, not a folder —
                    which is also why it is outside the tree's roving-tabindex ring. */}
                <button
                    type="button"
                    className="folder-rail__row folder-rail__row_trash"
                    onClick={onOpenTrash}
                >
                    <Trash size={15} className="folder-rail__icon" />
                    <span className="folder-rail__name">Trash</span>
                    {trashCount > 0 ? (
                        <span className="folder-rail__count">{trashCount}</span>
                    ) : null}
                </button>
            </div>

            <button
                type="button"
                className="folder-rail__footer"
                onClick={() => setNewFolderParent('')}
            >
                <FolderPlus size={15} />
                <span>New Folder</span>
            </button>

            {/* The one shared action menu — controlled, anchored to whichever row's ⋯ button (or the
                cursor, for a right-click) opened it, so the rail needs no per-row Menu instance. */}
            <Menu
                open={contextMenu !== null}
                onOpenChange={(open) => {
                    if (!open) setContextMenu(null);
                }}
                anchor={contextMenu?.anchor}
                align="start"
                width={224}
                finalFocus={false}
            >
                {menuRow ? (
                    <>
                        <MenuItem
                            icon={menuRow.pinned ? <PinSlash size={16} /> : <Pin size={16} />}
                            onClick={() => onTogglePin(menuRow.path)}
                        >
                            {menuRow.pinned ? 'Unpin' : 'Pin to top'}
                        </MenuItem>
                        <MenuItem
                            icon={<Pencil size={16} />}
                            hint="F2"
                            onClick={() => setRenaming({path: menuRow.path, value: menuRow.name})}
                        >
                            Rename
                        </MenuItem>
                        <MenuItem
                            icon={<Plus size={16} />}
                            hint="n"
                            onClick={() => startNewSubfolder(menuRow)}
                        >
                            New subfolder
                        </MenuItem>
                        {onReveal ? (
                            <MenuItem
                                icon={<FolderOpen size={16} />}
                                onClick={() => onReveal(menuRow.path)}
                            >
                                Reveal in Finder
                            </MenuItem>
                        ) : null}
                        <MenuSeparator />
                        {/* Disabled, not hidden, while the folder has contents — with the reason in a
                            tooltip. Base UI keeps disabled items focusable, so it is reachable from
                            the keyboard too, which is the point of not hiding it. */}
                        {deletable ? (
                            <MenuItem
                                icon={<Trash size={16} />}
                                hint="⌫"
                                danger
                                onClick={() => onRemoveFolder(menuRow.path)}
                            >
                                Delete folder
                            </MenuItem>
                        ) : (
                            <Tooltip label="Only an empty folder can be deleted" side="bottom">
                                <MenuItem icon={<Trash size={16} />} hint="⌫" danger disabled>
                                    Delete folder
                                </MenuItem>
                            </Tooltip>
                        )}
                    </>
                ) : null}
            </Menu>
        </div>
    );
});
