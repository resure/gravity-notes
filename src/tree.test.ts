import {describe, expect, it} from 'vitest';

import {DEFAULT_METADATA} from './storage/metadata';
import type {NoteMeta, NotesMetadata} from './storage/types';
import {buildFolderTree, notesInFolder} from './tree';

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

/** Compact view of the folder rows for assertions: "<indent><name>/". */
function shape(rows: ReturnType<typeof buildFolderTree>): string[] {
    return rows.map((row) => `${'  '.repeat(row.depth)}${row.name}/`);
}

describe('buildFolderTree', () => {
    it('is empty when there are no folders (notes alone create none at root)', () => {
        expect(buildFolderTree([], [note('A.md'), note('B.md')], meta(), new Set())).toEqual([]);
    });

    it('lists folders only — never notes — and nests by depth', () => {
        const rows = buildFolderTree(
            ['A', 'A/B', 'A/B/C'],
            [note('A/B/C/Deep.md')],
            meta(),
            new Set(),
        );
        expect(shape(rows)).toEqual(['A/', '  B/', '    C/']);
    });

    it('omits a collapsed folder’s subfolders but keeps the folder', () => {
        const rows = buildFolderTree(['A', 'A/B'], [], meta(), new Set(['A']));
        expect(shape(rows)).toEqual(['A/']);
        expect(rows[0].collapsed).toBe(true);
        expect(rows[0].hasChildren).toBe(true);
    });

    it('hasChildren reflects subfolders, not notes', () => {
        const rows = buildFolderTree(['Work'], [note('Work/Plan.md')], meta(), new Set());
        expect(rows).toHaveLength(1);
        expect(rows[0].hasChildren).toBe(false); // a note inside is not a rail child
    });

    it('shows a deliberately-empty folder', () => {
        const rows = buildFolderTree(['Projects'], [], meta(), new Set());
        expect(shape(rows)).toEqual(['Projects/']);
        expect(rows[0].noteCount).toBe(0);
    });

    it('counts notes recursively for the badge', () => {
        const rows = buildFolderTree(
            ['A', 'A/B'],
            [note('A/x.md'), note('A/B/y.md'), note('A/B/z.md')],
            meta(),
            new Set(),
        );
        expect(rows.find((r) => r.path === 'A')?.noteCount).toBe(3);
        expect(rows.find((r) => r.path === 'A/B')?.noteCount).toBe(2);
    });

    it('orders each level: pinned folders first, then by name', () => {
        const rows = buildFolderTree(
            ['Beta', 'Alpha', 'Gamma'],
            [],
            meta({pinned: ['Beta']}),
            new Set(),
        );
        expect(shape(rows)).toEqual(['Beta/', 'Alpha/', 'Gamma/']);
    });

    it('synthesizes missing ancestor folders so a nested folder is never orphaned', () => {
        const rows = buildFolderTree([], [note('A/B/Note.md')], meta(), new Set());
        expect(shape(rows)).toEqual(['A/', '  B/']);
    });
});

describe('notesInFolder', () => {
    const notes = [note('Root.md'), note('Work/Plan.md'), note('Work/Sub/Deep.md')];

    it('returns every note for the All-Notes root (null)', () => {
        expect(notesInFolder(notes, null).map((n) => n.id)).toEqual([
            'Root.md',
            'Work/Plan.md',
            'Work/Sub/Deep.md',
        ]);
    });

    it('returns only the direct children of a folder (not descendants)', () => {
        expect(notesInFolder(notes, 'Work').map((n) => n.id)).toEqual(['Work/Plan.md']);
    });

    it('returns the root-level notes for the empty-string root', () => {
        expect(notesInFolder(notes, '').map((n) => n.id)).toEqual(['Root.md']);
    });
});
