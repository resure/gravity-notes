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

    // Recursive note counts: each note increments every one of its ancestor folders.
    const noteCounts = new Map<string, number>();
    for (const note of notes) {
        for (let p = dirname(note.id); p; p = dirname(p)) {
            noteCounts.set(p, (noteCounts.get(p) ?? 0) + 1);
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
                noteCount: noteCounts.get(folder) ?? 0,
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
