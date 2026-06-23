import {describe, expect, it} from 'vitest';

import {DEFAULT_METADATA} from './storage/metadata';
import type {NoteMeta, NotesMetadata} from './storage/types';
import {buildTree, visibleNoteIds} from './tree';

const note = (id: string, updatedAt = 1): NoteMeta => ({
    id,
    title: id.slice(id.lastIndexOf('/') + 1).replace(/\.md$/, ''),
    updatedAt,
});

const meta = (over: Partial<NotesMetadata> = {}): NotesMetadata => ({
    ...DEFAULT_METADATA,
    sort: 'title',
    ...over,
});

/** Compact view of the tree for assertions: "<indent><folder>/" or "<indent>note". */
function shape(rows: ReturnType<typeof buildTree>): string[] {
    return rows.map((row) => {
        const indent = '  '.repeat(row.depth);
        return row.kind === 'folder' ? `${indent}${row.name}/` : `${indent}${row.note.title}`;
    });
}

describe('buildTree', () => {
    it('lists root notes flat when there are no folders', () => {
        const rows = buildTree([note('B.md'), note('A.md')], [], meta(), new Set());
        expect(shape(rows)).toEqual(['A', 'B']); // title sort
        expect(rows.every((r) => r.depth === 0)).toBe(true);
    });

    it('groups notes under their folder, folders before notes, indented', () => {
        const rows = buildTree(
            [note('Root.md'), note('Work/Plan.md'), note('Work/Standup.md')],
            ['Work'],
            meta(),
            new Set(),
        );
        expect(shape(rows)).toEqual(['Work/', '  Plan', '  Standup', 'Root']);
    });

    it('nests deeper folders with increasing depth', () => {
        const rows = buildTree([note('A/B/C/Deep.md')], ['A', 'A/B', 'A/B/C'], meta(), new Set());
        expect(shape(rows)).toEqual(['A/', '  B/', '    C/', '      Deep']);
    });

    it('omits the children of a collapsed folder but keeps the header', () => {
        const rows = buildTree([note('Work/Plan.md')], ['Work'], meta(), new Set(['Work']));
        expect(shape(rows)).toEqual(['Work/']);
        const header = rows[0];
        expect(header.kind === 'folder' && header.collapsed).toBe(true);
        expect(header.kind === 'folder' && header.hasChildren).toBe(true);
    });

    it('shows a deliberately-empty folder (in the folder list, no notes)', () => {
        const rows = buildTree([], ['Projects'], meta(), new Set());
        expect(shape(rows)).toEqual(['Projects/']);
        expect(rows[0].kind === 'folder' && rows[0].hasChildren).toBe(false);
    });

    it('orders each level: pinned folders, unpinned folders, pinned notes, unpinned notes', () => {
        const rows = buildTree(
            [note('Apple.md'), note('Zebra.md')],
            ['Beta', 'Alpha'],
            meta({pinned: ['Beta', 'Zebra.md']}),
            new Set(),
        );
        // Beta pinned → before Alpha; Zebra pinned → before Apple; all folders before notes.
        expect(shape(rows)).toEqual(['Beta/', 'Alpha/', 'Zebra', 'Apple']);
    });

    it('synthesizes missing ancestor folders so a nested note is never orphaned', () => {
        const rows = buildTree([note('A/B/Note.md')], [], meta(), new Set());
        expect(shape(rows)).toEqual(['A/', '  B/', '    Note']);
    });

    it('visibleNoteIds is the in-order note projection, skipping folder headers', () => {
        const rows = buildTree(
            [note('Root.md'), note('Work/Plan.md')],
            ['Work', 'Empty'],
            meta(),
            new Set(),
        );
        expect(visibleNoteIds(rows)).toEqual(['Work/Plan.md', 'Root.md']);
    });

    it("drops a collapsed folder's notes from the cursor projection", () => {
        const rows = buildTree(
            [note('Work/Plan.md'), note('Root.md')],
            ['Work'],
            meta(),
            new Set(['Work']),
        );
        expect(visibleNoteIds(rows)).toEqual(['Root.md']);
    });
});
