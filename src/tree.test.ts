import {describe, expect, it} from 'vitest';

import {DEFAULT_METADATA} from './storage/metadata';
import type {NoteMeta, NotesMetadata} from './storage/types';
import {buildFolderTree, buildMoveTargets, notesInFolder, synthesizeFolderPaths} from './tree';

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

describe('synthesizeFolderPaths', () => {
    it('returns every folder plus the ancestors implied by folders and note paths', () => {
        const paths = synthesizeFolderPaths(['Work/Sub'], [note('Personal/Trips/Japan.md')]);
        expect([...paths].sort()).toEqual(['Personal', 'Personal/Trips', 'Work', 'Work/Sub']);
    });

    it('returns every folder plus ancestors from a note path alone (no explicit folders)', () => {
        expect([...synthesizeFolderPaths([], [note('A/B/C/Deep.md')])].sort()).toEqual([
            'A',
            'A/B',
            'A/B/C',
        ]);
    });
});

describe("buildFolderTree — 'expanded-set' mode (the rail)", () => {
    it('treats the state set as EXPANSIONS: every folder collapsed unless listed', () => {
        const folders = ['Work', 'Work/Sub', 'Personal'];
        // Only `Work` is expanded → its subfolder shows; `Personal` stays collapsed (closed caret).
        const rows = buildFolderTree(folders, [], meta(), new Set(['Work']), 'expanded-set');
        expect(shape(rows)).toEqual(['Personal/', 'Work/', '  Sub/']);
        expect(rows.find((r) => r.name === 'Personal')?.collapsed).toBe(true);
        expect(rows.find((r) => r.name === 'Work')?.collapsed).toBe(false);
    });

    it('collapses everything when nothing is expanded (the default first-run view)', () => {
        const rows = buildFolderTree(['A', 'A/B', 'C'], [], meta(), new Set(), 'expanded-set');
        // Only the roots show; their subfolders stay hidden until expanded.
        expect(shape(rows)).toEqual(['A/', 'C/']);
        expect(rows.every((r) => r.collapsed)).toBe(true);
    });
});

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

    it('counts only direct notes when expanded (subfolders show their own counts)', () => {
        const notes = [note('A/x.md'), note('A/B/y.md'), note('A/B/z.md')];
        const rows = buildFolderTree(['A', 'A/B'], notes, meta(), new Set());
        expect(rows.find((r) => r.path === 'A')?.noteCount).toBe(1); // just A/x.md
        expect(rows.find((r) => r.path === 'A/B')?.noteCount).toBe(2);
    });

    it('rolls the count up recursively for a collapsed folder', () => {
        const notes = [note('A/x.md'), note('A/B/y.md'), note('A/B/z.md')];
        const rows = buildFolderTree(['A', 'A/B'], notes, meta(), new Set(['A']));
        // A is collapsed, so it summarizes its whole hidden subtree (1 direct + 2 under A/B).
        expect(rows.find((r) => r.path === 'A')?.noteCount).toBe(3);
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

describe('buildMoveTargets', () => {
    const FOLDERS = ['Work', 'Work/Projects', 'Work/Archive', 'Personal'];

    /** Compact view: "<indent><name>" with a "*" when matched and a "!" when disabled. */
    function shapeTargets(rows: ReturnType<typeof buildMoveTargets>): string[] {
        return rows.map(
            (r) =>
                `${'  '.repeat(r.depth)}${r.name}${r.matched ? '*' : ''}${r.disabled ? '!' : ''}`,
        );
    }

    it('returns the whole collapse-respecting tree when there is no filter', () => {
        const rows = buildMoveTargets(FOLDERS, [], meta(), 'Personal', new Set(), '');
        // Ordering mirrors the rail: by name per level (Personal < Work), the current folder disabled.
        expect(shapeTargets(rows)).toEqual([
            'Personal!', // the note's current folder is disabled (a no-op move)
            'Work',
            '  Archive',
            '  Projects',
        ]);
    });

    it('respects the picker’s own collapse set (unfiltered)', () => {
        const rows = buildMoveTargets(FOLDERS, [], meta(), '', new Set(['Work']), '');
        expect(shapeTargets(rows)).toEqual(['Personal', 'Work']);
        const work = rows.find((r) => r.path === 'Work');
        expect(work?.collapsed).toBe(true);
        expect(work?.hasChildren).toBe(true);
    });

    it('filters by folder name and keeps ancestors for context', () => {
        const rows = buildMoveTargets(FOLDERS, [], meta(), '', new Set(), 'arch');
        // Work is kept only as the matched Archive's ancestor (not itself a match).
        expect(shapeTargets(rows)).toEqual(['Work', '  Archive*']);
    });

    it('ignores collapse while filtering (matched subtree is force-shown)', () => {
        const rows = buildMoveTargets(FOLDERS, [], meta(), '', new Set(['Work']), 'proj');
        expect(shapeTargets(rows)).toEqual(['Work', '  Projects*']);
        // No carets while filtering — the subtree is always expanded.
        expect(rows.every((r) => !r.hasChildren)).toBe(true);
    });

    it('marks the current folder disabled even when it matches the filter', () => {
        const rows = buildMoveTargets(FOLDERS, [], meta(), 'Work/Projects', new Set(), 'proj');
        const projects = rows.find((r) => r.path === 'Work/Projects');
        expect(projects?.matched).toBe(true);
        expect(projects?.disabled).toBe(true);
    });

    it('returns nothing when no folder name matches', () => {
        expect(buildMoveTargets(FOLDERS, [], meta(), '', new Set(), 'zzz')).toEqual([]);
    });
});
