import {forwardRef, useEffect, useImperativeHandle, useRef, useState} from 'react';
import type {DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent} from 'react';

import {
    ChevronDown,
    ChevronRight,
    Ellipsis,
    Folder,
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
    /** Move focus into the notes list (Enter / → off a leaf folder). */
    onFocusList: () => void;
}

/** Left padding (px) for a row at the given tree depth. */
function indentFor(depth: number): number {
    return 10 + depth * 14;
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
    const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const newFolderInputRef = useRef<HTMLInputElement>(null);
    const renameInputRef = useRef<HTMLInputElement>(null);

    // The flat keyboard order: All Notes, then each visible folder row.
    const navItems: {key: string; folder: string | null; row?: FolderRow}[] = [
        {key: ALL_KEY, folder: null},
        ...rows.map((row) => ({key: row.path, folder: row.path, row})),
    ];
    const selectedKey = selectedFolder === null ? ALL_KEY : selectedFolder;
    // The tabbable row: the selected one if it's visible, else fall back to All Notes.
    const focusableKey = navItems.some((i) => i.key === selectedKey) ? selectedKey : ALL_KEY;

    useEffect(() => {
        if (newFolderParent !== null) newFolderInputRef.current?.focus();
    }, [newFolderParent]);
    useEffect(() => {
        if (renaming) renameInputRef.current?.focus();
    }, [renaming]);

    const focusRow = (key: string) => itemRefs.current.get(key)?.focus();

    useImperativeHandle(
        ref,
        () => ({
            focusSelected() {
                focusRow(focusableKey);
            },
            startRename(path: string) {
                setRenaming({path, value: basename(path)});
            },
        }),
        [focusableKey],
    );

    const select = (item: {key: string; folder: string | null}) => {
        onSelectFolder(item.folder);
        focusRow(item.key);
    };

    const submitNewFolder = () => {
        const name = newFolderName.trim();
        const parent = newFolderParent;
        setNewFolderParent(null);
        setNewFolderName('');
        if (parent !== null && name) onCreateFolder(parent, name);
    };

    const submitRename = () => {
        const current = renaming;
        setRenaming(null);
        if (!current) return;
        const leaf = sanitizeSegment(current.value.trim());
        const next = joinPath(dirname(current.path), leaf);
        if (current.value.trim() && next !== current.path) onMoveFolder(current.path, next);
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
            onFocusList();
        }
    };

    // n / Backspace|Delete over a focused folder: new subfolder, or remove an empty one.
    const onActionKey = (
        event: ReactKeyboardEvent<HTMLDivElement>,
        folder: string | null,
        row: FolderRow | undefined,
    ) => {
        if (event.key === 'n') {
            event.preventDefault();
            setNewFolderParent(folder ?? '');
        } else if ((event.key === 'Backspace' || event.key === 'Delete') && row) {
            event.preventDefault();
            if (row.noteCount === 0 && !row.hasChildren) onRemoveFolder(row.path);
        }
    };

    const onRowKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, key: string) => {
        const index = navItems.findIndex((i) => i.key === key);
        if (index === -1) return;
        const {folder, row} = navItems[index];
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
            onActionKey(event, folder, row);
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

    const renderFolder = (row: FolderRow) => {
        if (renaming?.path === row.path) return renderRenameInput(row);
        const selected = selectedFolder === row.path;
        const deletable = row.noteCount === 0 && !row.hasChildren;
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
                }}
                onClick={() => select({key: row.path, folder: row.path})}
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
                        items={[
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
                                action: () => setNewFolderParent(row.path),
                            },
                            {
                                text: 'Delete folder',
                                theme: 'danger',
                                iconStart: <Icon data={TrashBin} />,
                                // Only a truly empty folder (no notes, no subfolders) can be removed.
                                disabled: !deletable,
                                action: () => onRemoveFolder(row.path),
                            },
                        ]}
                    />
                </div>
            </div>
        );
    };

    return (
        <div className="folder-rail">
            <div className="folder-rail__items" role="tree" aria-label="Folders">
                {renderAllNotes()}
                {newFolderParent === null ? null : (
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
                )}
                {rows.map(renderFolder)}
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
        </div>
    );
});
