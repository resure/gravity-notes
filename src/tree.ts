/**
 * Pure sidebar-tree construction: turn the flat note list + folder list into an ordered,
 * indentation-aware row sequence for the nested-folder sidebar. No I/O, no React — so it stays
 * trivially unit-testable, like search.ts.
 *
 * Ordering rule (per folder level): pinned folders, then unpinned folders, then pinned notes, then
 * unpinned notes — folders above notes, pins floating to the top within each kind. Folders sort by
 * name; notes reuse `orderNotes` (which already floats pins and applies the active sort).
 */

import {orderNotes} from './storage/metadata';
import {basename, dirname} from './storage/noteText';
import type {NoteMeta, NotesMetadata} from './storage/types';

/** A folder header row, or a note row, with its depth (for indentation). */
export type TreeRow =
    | {
          kind: 'folder';
          /** Full POSIX folder path (the id used for pin/collapse/selection). */
          path: string;
          /** Last path segment, for display. */
          name: string;
          depth: number;
          collapsed: boolean;
          pinned: boolean;
          /** Whether the folder has any child folder or note (drives the disclosure affordance). */
          hasChildren: boolean;
      }
    | {kind: 'note'; note: NoteMeta; depth: number; pinned: boolean};

function pushTo<T>(map: Map<string, T[]>, key: string, value: T): void {
    const existing = map.get(key);
    if (existing) existing.push(value);
    else map.set(key, [value]);
}

/**
 * Build the visible tree rows. `collapsed` is the set of folder paths whose children are hidden.
 * `folders` need not be complete — every ancestor implied by a folder or a note path is synthesized,
 * so no folder is ever orphaned.
 */
export function buildTree(
    notes: NoteMeta[],
    folders: string[],
    metadata: NotesMetadata,
    collapsed: ReadonlySet<string>,
): TreeRow[] {
    const pinned = new Set(metadata.pinned);

    // Every folder path that should exist, including synthesized ancestors.
    const allFolders = new Set<string>();
    const addWithAncestors = (path: string) => {
        for (let p = path; p; p = dirname(p)) allFolders.add(p);
    };
    folders.forEach(addWithAncestors);
    notes.forEach((note) => addWithAncestors(dirname(note.id)));

    // Child folders keyed by parent path (''=root), and notes keyed by their folder path.
    const childFolders = new Map<string, string[]>();
    for (const folder of allFolders) pushTo(childFolders, dirname(folder), folder);
    const notesByFolder = new Map<string, NoteMeta[]>();
    for (const note of notes) pushTo(notesByFolder, dirname(note.id), note);

    const rows: TreeRow[] = [];
    const emitLevel = (parentPath: string, depth: number) => {
        const levelFolders = [...(childFolders.get(parentPath) ?? [])].sort(
            (a, b) =>
                Number(pinned.has(b)) - Number(pinned.has(a)) ||
                basename(a).localeCompare(basename(b)),
        );
        for (const folder of levelFolders) {
            const isCollapsed = collapsed.has(folder);
            rows.push({
                kind: 'folder',
                path: folder,
                name: basename(folder),
                depth,
                collapsed: isCollapsed,
                pinned: pinned.has(folder),
                hasChildren:
                    (childFolders.get(folder)?.length ?? 0) > 0 ||
                    (notesByFolder.get(folder)?.length ?? 0) > 0,
            });
            if (!isCollapsed) emitLevel(folder, depth + 1);
        }
        // orderNotes floats this level's pinned notes to the top, then applies the active sort.
        for (const note of orderNotes(notesByFolder.get(parentPath) ?? [], metadata)) {
            rows.push({kind: 'note', note, depth, pinned: pinned.has(note.id)});
        }
    };
    emitLevel('', 0);
    return rows;
}

/** The visible note ids in order — the projection the keyboard cursor moves over (headers skipped). */
export function visibleNoteIds(rows: TreeRow[]): string[] {
    return rows.flatMap((row) => (row.kind === 'note' ? [row.note.id] : []));
}
