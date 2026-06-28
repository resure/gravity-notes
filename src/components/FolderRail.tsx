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
    TrashBin,
} from '@gravity-ui/icons';
import {Button, DropdownMenu, Icon, Text, TextInput} from '@gravity-ui/uikit';

import {basename, dirname, joinPath, sanitizeSegment} from '../storage/noteText';
import type {FolderRow} from '../tree';

import './FolderRail.css';

/** Row key for the special "All Notes" entry (folder paths are always non-empty). */
const ALL_KEY = ' all';
/** dataTransfer type carrying a dragged folder's path (notes use `text/plain`, so the two differ). */
const FOLDER_MIME = 'application/x-gravity-folder';

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
    /** Move / rename a folder (re-keying its whole subtree). */
    onMoveFolder: (fromPath: string, toPath: string) => void;
    /** Toggle a folder's pin. */
    onTogglePin: (path: string) => void;
    /** Move a dropped note into a folder (`''` = root). */
    onMoveTo: (noteId: string, destFolder: string) => void;
    /** Reveal a folder in Finder — present only on the native desktop backend (else hidden). */
    onReveal?: (path: string) => void;
    /** Move focus into the notes list (Enter / → off a leaf folder). */
    onFocusList: () => void;
}

/** Left padding (px) for a row at the given tree depth. */
function indentFor(depth: number): number {
    return 2 + depth * 14;
}

/** Whether dropping the dragged folder onto `target` (`''` = root) is forbidden (self / descendant). */
function isInvalidFolderDrop(target: string, dragged: string): boolean {
    return target === dragged || target.startsWith(`${dragged}/`);
}

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
    // The folder + viewport point for an open right-click context menu (null = closed).
    const [contextMenu, setContextMenu] = useState<{row: FolderRow; x: number; y: number} | null>(
        null,
    );
    const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const newFolderInputRef = useRef<HTMLInputElement>(null);
    const renameInputRef = useRef<HTMLInputElement>(null);

    // Edge autoscroll: while a drag hovers near the top/bottom of the scroll area, keep scrolling so
    // off-screen folders are reachable. A rAF loop runs while `scrollDirRef` is non-zero.
    const itemsRef = useRef<HTMLDivElement>(null);
    const scrollDirRef = useRef(0);
    const rafRef = useRef<number | null>(null);
    const stepAutoScroll = useCallback(() => {
        const el = itemsRef.current;
        if (!el || scrollDirRef.current === 0) {
            rafRef.current = null;
            return;
        }
        el.scrollTop += scrollDirRef.current * 8;
        rafRef.current = requestAnimationFrame(stepAutoScroll);
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
        },
        [stepAutoScroll],
    );
    const stopAutoScroll = useCallback(() => {
        scrollDirRef.current = 0;
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
    }, []);
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
    useEffect(() => {
        if (renaming) renameInputRef.current?.focus();
    }, [renaming]);

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
            pendingRenameToRef.current = next; // select + focus it once the refreshed tree shows it
            onMoveFolder(current.path, next);
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
        // A folder drag onto itself / a descendant is forbidden; note drags are always allowed.
        if (draggingFolder && isInvalidFolderDrop(target, draggingFolder)) return;
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
        const id = event.dataTransfer.getData('text/plain');
        if (id) onMoveTo(id, target);
    };

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
                style={{paddingInlineStart: indentFor(0)}}
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
                <Icon className="folder-rail__icon" data={Layers} size={16} />
                <Text className="folder-rail__name" ellipsis>
                    All Notes
                </Text>
                {allNotesCount > 0 ? (
                    <span className="folder-rail__count">{allNotesCount}</span>
                ) : null}
                {/* Reserve the same trailing slot as a folder row's ⋯ menu, so counts line up. */}
                <span className="folder-rail__actions-spacer" aria-hidden />
            </div>
        );
    };

    const renderRenameInput = (row: FolderRow) => (
        <div
            key={row.path}
            className="folder-rail__row"
            style={{paddingInlineStart: indentFor(row.depth)}}
        >
            <span className="folder-rail__caret" />
            <Icon className="folder-rail__icon" data={Folder} size={16} aria-hidden />
            <TextInput
                className="folder-rail__input"
                controlRef={renameInputRef}
                size="s"
                view="clear"
                value={renaming?.value ?? ''}
                onUpdate={(value) => setRenaming((r) => (r ? {...r, value} : r))}
                onBlur={submitRename}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        submitRename();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setRenaming(null);
                    }
                }}
            />
        </div>
    );

    // The per-folder action list, shared by the row's ⋯ menu and the right-click context menu.
    const folderMenuItems = (row: FolderRow) => {
        const deletable = row.noteCount === 0 && !row.hasChildren;
        return [
            {
                text: row.pinned ? 'Unpin' : 'Pin to top',
                iconStart: <Icon data={row.pinned ? PinSlash : Pin} />,
                action: () => onTogglePin(row.path),
            },
            {
                text: 'Rename',
                iconStart: <Icon data={Pencil} />,
                action: () => setRenaming({path: row.path, value: row.name}),
            },
            {
                text: 'New subfolder',
                iconStart: <Icon data={FolderPlus} />,
                action: () => startNewSubfolder(row),
            },
            // Desktop only: revealed in Finder when the backend supports it.
            ...(onReveal
                ? [
                      {
                          text: 'Reveal in Finder',
                          iconStart: <Icon data={FolderOpen} />,
                          action: () => onReveal(row.path),
                      },
                  ]
                : []),
            {
                text: 'Delete folder',
                theme: 'danger' as const,
                iconStart: <Icon data={TrashBin} />,
                // Only a truly empty folder (no notes, no subfolders) can be removed.
                disabled: !deletable,
                action: () => onRemoveFolder(row.path),
            },
        ];
    };

    // A zero-size virtual anchor at the right-click point, so the context menu opens at the cursor.
    const contextAnchor = useMemo(
        () =>
            contextMenu
                ? {getBoundingClientRect: () => new DOMRect(contextMenu.x, contextMenu.y, 0, 0)}
                : undefined,
        [contextMenu],
    );

    const renderFolder = (row: FolderRow) => {
        if (renaming?.path === row.path) return renderRenameInput(row);
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
                style={{paddingInlineStart: indentFor(row.depth)}}
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
                    setContextMenu({row, x: e.clientX, y: e.clientY});
                }}
                onDoubleClick={() => setRenaming({path: row.path, value: row.name})}
                onKeyDown={(e) => onRowKeyDown(e, row.path)}
                onDragOver={(e) => onRowDragOver(e, row.path, row.path)}
                onDragLeave={() => setDropTarget((t) => (t === row.path ? null : t))}
                onDrop={(e) => onRowDrop(e, row.path)}
            >
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
                        <Icon data={row.collapsed ? ChevronRight : ChevronDown} size={14} />
                    </button>
                ) : (
                    <span className="folder-rail__caret" />
                )}
                <Icon className="folder-rail__icon" data={Folder} size={16} />
                {row.pinned ? (
                    <Icon className="folder-rail__pin" data={PinFill} size={12} aria-hidden />
                ) : null}
                <Text className="folder-rail__name" ellipsis>
                    {row.name}
                </Text>
                {row.noteCount > 0 ? (
                    <span className="folder-rail__count">{row.noteCount}</span>
                ) : null}
                <div className="folder-rail__actions">
                    <DropdownMenu
                        renderSwitcher={(props) => (
                            <Button
                                {...props}
                                view="flat"
                                size="s"
                                tabIndex={-1}
                                aria-label={`${row.name} actions`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    props.onClick?.(e);
                                }}
                            >
                                <Icon data={Ellipsis} />
                            </Button>
                        )}
                        items={folderMenuItems(row)}
                    />
                </div>
            </div>
        );
    };

    // The inline new-folder editor, indented to its parent's child depth ('' root = depth 0).
    const renderNewFolderInput = () => (
        <div
            className="folder-rail__row"
            style={{
                paddingInlineStart: indentFor(
                    newFolderParent ? newFolderParent.split('/').length : 0,
                ),
            }}
        >
            <span className="folder-rail__caret" />
            <Icon className="folder-rail__icon" data={Folder} size={16} aria-hidden />
            <TextInput
                className="folder-rail__input"
                controlRef={newFolderInputRef}
                size="s"
                view="clear"
                placeholder="Folder name"
                value={newFolderName}
                onUpdate={setNewFolderName}
                onBlur={submitNewFolder}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        submitNewFolder();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setNewFolderParent(null);
                        setNewFolderName('');
                    }
                }}
            />
        </div>
    );

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
            <div ref={itemsRef} className="folder-rail__items" role="tree" aria-label="Folders">
                {renderAllNotes()}
                {/* A new root folder sits at the top; a new subfolder renders under its parent row. */}
                {newFolderParent === '' ? renderNewFolderInput() : null}
                {rows.map((row) => (
                    <Fragment key={row.path}>
                        {renderFolder(row)}
                        {newFolderParent === row.path ? renderNewFolderInput() : null}
                    </Fragment>
                ))}
                {/* First-run nudge: no folders yet, and not already typing a new one. */}
                {rows.length === 0 && newFolderParent === null ? (
                    <div className="folder-rail__hint">
                        <Text color="hint" variant="caption-2">
                            No folders yet. Add one to group your notes.
                        </Text>
                    </div>
                ) : null}
            </div>
            <div className="folder-rail__footer">
                <Button
                    view="flat"
                    size="s"
                    width="max"
                    aria-label="New folder"
                    onClick={() => setNewFolderParent('')}
                >
                    <Icon data={FolderPlus} />
                    New Folder
                </Button>
            </div>

            {/* Right-click context menu — one instance, controlled and anchored to the cursor via a
                virtual element, so it needs no trigger of its own. Gravity substitutes its default ⋯
                switcher button when renderSwitcher returns null/undefined, so return a hidden element
                instead — otherwise that kebab leaks into the rail as a stray bottom-left button. */}
            <DropdownMenu
                open={contextMenu !== null}
                onOpenToggle={(open: boolean) => {
                    if (!open) setContextMenu(null);
                }}
                renderSwitcher={() => <span hidden />}
                popupProps={{anchorElement: contextAnchor}}
                items={contextMenu ? folderMenuItems(contextMenu.row) : []}
            />
        </div>
    );
});
