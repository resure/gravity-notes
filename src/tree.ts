/**
 * Pure folder-tree construction for the sidebar rail: turn the flat folder list (plus the folders
 * implied by note paths) into an ordered, indentation-aware row sequence. No I/O, no React — so it
 * stays trivially unit-testable, like search.ts.
 *
 * The rail shows folders ONLY; a folder's notes live in the middle pane (`notesInFolder`). A folder
 * is expandable when it has *subfolders* (notes never appear in the rail). Ordering rule per level:
 * pinned folders first, then unpinned, each sorted by name.
 */

import {basename, dirname} from './storage/noteText';
import type {NoteMeta, NotesMetadata} from './storage/types';

/** One folder row in the rail. */
export interface FolderRow {
    /** Full POSIX folder path — the id used for pin / collapse / selection. */
    path: string;
    /** Last path segment, for display. */
    name: string;
    depth: number;
    collapsed: boolean;
    pinned: boolean;
    /** Whether the folder has a *subfolder* (drives the disclosure caret; notes don't count). */
    hasChildren: boolean;
    /** Count of notes anywhere under this folder (recursive), for the row badge. */
    noteCount: number;
}

/**
 * Build the visible folder rows. `collapsed` is the set of folder paths whose subfolders are hidden.
 * `folders` need not be complete — every ancestor implied by a folder or a note path is synthesized,
 * so no folder is ever orphaned.
 */
export function buildFolderTree(
    folders: string[],
    notes: NoteMeta[],
    metadata: NotesMetadata,
    collapsed: ReadonlySet<string>,
): FolderRow[] {
    const pinned = new Set(metadata.pinned);

    // Every folder path that should exist, including synthesized ancestors.
    const allFolders = new Set<string>();
    const addWithAncestors = (path: string) => {
        for (let p = path; p; p = dirname(p)) allFolders.add(p);
    };
    folders.forEach(addWithAncestors);
    notes.forEach((note) => addWithAncestors(dirname(note.id)));

    // Child folders keyed by parent path ('' = root).
    const childFolders = new Map<string, string[]>();
    for (const folder of allFolders) {
        const parent = dirname(folder);
        const existing = childFolders.get(parent);
        if (existing) existing.push(folder);
        else childFolders.set(parent, [folder]);
    }

    // Two tallies per folder: notes *directly* inside it, and notes anywhere beneath it (recursive).
    // Each note bumps its own folder's direct count, and every ancestor's recursive count.
    const directCounts = new Map<string, number>();
    const recursiveCounts = new Map<string, number>();
    for (const note of notes) {
        const own = dirname(note.id);
        if (own) directCounts.set(own, (directCounts.get(own) ?? 0) + 1);
        for (let p = own; p; p = dirname(p)) {
            recursiveCounts.set(p, (recursiveCounts.get(p) ?? 0) + 1);
        }
    }

    const rows: FolderRow[] = [];
    const emit = (parentPath: string, depth: number) => {
        const level = [...(childFolders.get(parentPath) ?? [])].sort(
            (a, b) =>
                Number(pinned.has(b)) - Number(pinned.has(a)) ||
                basename(a).localeCompare(basename(b)),
        );
        for (const folder of level) {
            const isCollapsed = collapsed.has(folder);
            rows.push({
                path: folder,
                name: basename(folder),
                depth,
                collapsed: isCollapsed,
                pinned: pinned.has(folder),
                hasChildren: (childFolders.get(folder)?.length ?? 0) > 0,
                // Expanded → just this folder's own notes (its subfolders show their own counts
                // below); collapsed → the recursive rollup that summarizes the hidden subtree.
                noteCount: (isCollapsed ? recursiveCounts : directCounts).get(folder) ?? 0,
            });
            if (!isCollapsed) emit(folder, depth + 1);
        }
    };
    emit('', 0);
    return rows;
}

/**
 * The notes shown in the middle pane for a rail selection: `null` (All Notes) → every note;
 * a folder path → only the notes *directly* in it (subfolders are reached via the rail). Order is
 * preserved from the input, so callers pass an already-ordered list.
 */
export function notesInFolder(notes: NoteMeta[], folder: string | null): NoteMeta[] {
    if (folder === null) return notes;
    return notes.filter((note) => dirname(note.id) === folder);
}

/** One destination row in the "Move to…" picker (the `''` root is rendered separately). */
export interface MoveTargetRow {
    /** Full POSIX folder path. */
    path: string;
    /** Last path segment, for display. */
    name: string;
    depth: number;
    /** Has a *subfolder* — drives the disclosure caret (only meaningful unfiltered). */
    hasChildren: boolean;
    collapsed: boolean;
    /** The note's current folder: moving there is a no-op, so the row is shown disabled. */
    disabled: boolean;
    /** The folder name matches the active filter — for match highlight + default focus. */
    matched: boolean;
}

/**
 * Folder rows for the "Move to…" picker. Reuses the rail's tree shape (synthesized ancestors,
 * pinned-first ordering), but:
 *  - marks the note's `currentFolder` `disabled` (moving there is a no-op),
 *  - with an empty `query`, respects the picker's own `collapsed` set (a tidy, collapsible tree),
 *  - with a `query`, ignores collapse and keeps only folders whose *name* matches (case-insensitive
 *    substring) plus their ancestors, so the surviving rows stay a connected, indented tree.
 */
export function buildMoveTargets(
    folders: string[],
    notes: NoteMeta[],
    metadata: NotesMetadata,
    currentFolder: string,
    collapsed: ReadonlySet<string>,
    query: string,
): MoveTargetRow[] {
    const q = query.trim().toLowerCase();
    const toTarget = (row: FolderRow, matched: boolean): MoveTargetRow => ({
        path: row.path,
        name: row.name,
        depth: row.depth,
        // No carets while filtering — the matched subtree is force-shown.
        hasChildren: q ? false : row.hasChildren,
        collapsed: q ? false : row.collapsed,
        disabled: row.path === currentFolder,
        matched,
    });

    if (!q) {
        return buildFolderTree(folders, notes, metadata, collapsed).map((row) =>
            toTarget(row, false),
        );
    }

    // Fully-expanded tree, then keep matches and their ancestors (for indentation context).
    const full = buildFolderTree(folders, notes, metadata, new Set());
    const matches = (path: string) => basename(path).toLowerCase().includes(q);
    const keep = new Set<string>();
    for (const row of full) {
        if (matches(row.path)) {
            for (let p = row.path; p; p = dirname(p)) keep.add(p);
        }
    }
    return full.filter((row) => keep.has(row.path)).map((row) => toTarget(row, matches(row.path)));
}
