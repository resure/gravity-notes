import {describe, expect, it} from 'vitest';

import {
    DEFAULT_METADATA,
    METADATA_FILENAME,
    orderNotes,
    parseMetadata,
    reconcile,
    withActive,
    withClosed,
    withCreatedStamp,
    withOpened,
    withPinToggled,
    withRemoved,
    withRenamed,
    withSortMode,
} from './metadata';
import type {NoteMeta} from './types';

const note = (id: string, title: string, updatedAt: number): NoteMeta => ({id, title, updatedAt});

describe('METADATA_FILENAME', () => {
    it('is a dotfile so list() (which filters to .md) ignores it', () => {
        expect(METADATA_FILENAME).toBe('.gravity-notes.json');
        expect(METADATA_FILENAME.endsWith('.md')).toBe(false);
    });
});

describe('parseMetadata', () => {
    it('returns defaults for non-objects', () => {
        expect(parseMetadata(null)).toEqual(DEFAULT_METADATA);
        expect(parseMetadata('nope')).toEqual(DEFAULT_METADATA);
        expect(parseMetadata(42)).toEqual(DEFAULT_METADATA);
    });

    it('returns defaults for an unrecognized version', () => {
        expect(parseMetadata({version: 2, sort: 'title', pinned: [], created: {}})).toEqual(
            DEFAULT_METADATA,
        );
    });

    it('keeps valid fields and coerces invalid ones', () => {
        const parsed = parseMetadata({
            version: 1,
            sort: 'title',
            pinned: ['A.md', 7, 'B.md'],
            created: {'A.md': 100, 'B.md': 'bad'},
        });
        expect(parsed.sort).toBe('title');
        expect(parsed.pinned).toEqual(['A.md', 'B.md']);
        expect(parsed.created).toEqual({'A.md': 100});
    });

    it('falls back to updated for an unknown sort', () => {
        expect(parseMetadata({version: 1, sort: 'sideways', pinned: [], created: {}}).sort).toBe(
            'updated',
        );
    });

    it('does not share references with DEFAULT_METADATA', () => {
        const parsed = parseMetadata({});
        expect(parsed.pinned).not.toBe(DEFAULT_METADATA.pinned);
        expect(parsed.created).not.toBe(DEFAULT_METADATA.created);
    });

    it('does not share references with DEFAULT_METADATA on the happy path', () => {
        const parsed = parseMetadata({version: 1, sort: 'updated', pinned: [], created: {}});
        expect(parsed.pinned).not.toBe(DEFAULT_METADATA.pinned);
        expect(parsed.created).not.toBe(DEFAULT_METADATA.created);
    });
});

describe('immutable transforms', () => {
    const base = {
        version: 1,
        sort: 'updated',
        pinned: ['A.md'],
        created: {'A.md': 1},
        open: ['A.md'],
        active: 'A.md',
    } as const;

    it('withSortMode sets the sort without mutating the input', () => {
        const next = withSortMode(base, 'created');
        expect(next.sort).toBe('created');
        expect(base.sort).toBe('updated');
    });

    it('withPinToggled adds then removes an id', () => {
        const added = withPinToggled(base, 'B.md');
        expect(added.pinned).toEqual(['A.md', 'B.md']);
        const removed = withPinToggled(added, 'A.md');
        expect(removed.pinned).toEqual(['B.md']);
    });

    it('withCreatedStamp records a time only when absent', () => {
        const stamped = withCreatedStamp(base, 'B.md', 200);
        expect(stamped.created).toEqual({'A.md': 1, 'B.md': 200});
        const unchanged = withCreatedStamp(stamped, 'B.md', 999);
        expect(unchanged.created['B.md']).toBe(200);
    });

    it('withRenamed migrates pin membership and the created entry', () => {
        const next = withRenamed(base, 'A.md', 'A2.md');
        expect(next.pinned).toEqual(['A2.md']);
        expect(next.created).toEqual({'A2.md': 1});
    });

    it('withRenamed is a no-op when the id is unchanged', () => {
        expect(withRenamed(base, 'A.md', 'A.md')).toEqual(base);
    });

    it('withRemoved drops the id from pinned and created', () => {
        const next = withRemoved(base, 'A.md');
        expect(next.pinned).toEqual([]);
        expect(next.created).toEqual({});
    });
});

describe('reconcile', () => {
    it('drops pinned and created entries for ids that are not live', () => {
        const meta = {
            version: 1,
            sort: 'updated',
            pinned: ['A.md', 'ghost.md'],
            created: {'A.md': 1, 'ghost.md': 2},
            open: [],
            active: null,
        } as const;
        const next = reconcile(meta, ['A.md', 'B.md']);
        expect(next.pinned).toEqual(['A.md']);
        expect(next.created).toEqual({'A.md': 1});
    });

    it('drops everything when no ids are live', () => {
        const meta = {
            version: 1,
            sort: 'updated',
            pinned: ['A.md'],
            created: {'A.md': 1},
            open: [],
            active: null,
        } as const;
        const next = reconcile(meta, []);
        expect(next.pinned).toEqual([]);
        expect(next.created).toEqual({});
    });
});

describe('orderNotes', () => {
    const notes = [
        note('B.md', 'Beta', 300),
        note('A.md', 'Alpha', 100),
        note('C.md', 'Charlie', 200),
    ];

    it('sorts by updated (newest first) by default', () => {
        const meta = {...DEFAULT_METADATA};
        expect(orderNotes(notes, meta).map((n) => n.id)).toEqual(['B.md', 'C.md', 'A.md']);
    });

    it('sorts by title A→Z', () => {
        const meta = {...DEFAULT_METADATA, sort: 'title' as const};
        expect(orderNotes(notes, meta).map((n) => n.title)).toEqual(['Alpha', 'Beta', 'Charlie']);
    });

    it('sorts by created (newest first), falling back to updatedAt when unstamped', () => {
        const meta = {...DEFAULT_METADATA, sort: 'created' as const, created: {'A.md': 999}};
        // A has an explicit created of 999 (newest); B and C fall back to updatedAt 300/200.
        expect(orderNotes(notes, meta).map((n) => n.id)).toEqual(['A.md', 'B.md', 'C.md']);
    });

    it('keeps pinned notes on top, each group sorted by the active sort', () => {
        const meta = {...DEFAULT_METADATA, sort: 'title' as const, pinned: ['C.md']};
        // C is pinned (alone on top); the rest are alphabetical.
        expect(orderNotes(notes, meta).map((n) => n.id)).toEqual(['C.md', 'A.md', 'B.md']);
    });

    it('does not mutate the input array', () => {
        const input = [...notes];
        orderNotes(input, {...DEFAULT_METADATA, sort: 'title'});
        expect(input.map((n) => n.id)).toEqual(['B.md', 'A.md', 'C.md']);
    });
});

describe('parseMetadata — open tabs', () => {
    it('defaults open/active when absent', () => {
        const parsed = parseMetadata({version: 1, sort: 'updated', pinned: [], created: {}});
        expect(parsed.open).toEqual([]);
        expect(parsed.active).toBeNull();
    });

    it('keeps a valid open list and active id, dropping non-strings', () => {
        const parsed = parseMetadata({
            version: 1,
            sort: 'updated',
            pinned: [],
            created: {},
            open: ['A.md', 7, 'B.md'],
            active: 'B.md',
        });
        expect(parsed.open).toEqual(['A.md', 'B.md']);
        expect(parsed.active).toBe('B.md');
    });

    it('clears active when it is not in open', () => {
        const parsed = parseMetadata({
            version: 1,
            sort: 'updated',
            pinned: [],
            created: {},
            open: ['A.md'],
            active: 'ghost.md',
        });
        expect(parsed.active).toBeNull();
    });
});

describe('tab transforms', () => {
    const base = {
        version: 1,
        sort: 'updated',
        pinned: [],
        created: {},
        open: ['A.md', 'B.md'],
        active: 'A.md',
    } as const;

    it('withOpened appends a new id and activates it', () => {
        const next = withOpened(base, 'C.md');
        expect(next.open).toEqual(['A.md', 'B.md', 'C.md']);
        expect(next.active).toBe('C.md');
    });

    it('withOpened only activates an already-open id (no duplicate)', () => {
        const next = withOpened(base, 'B.md');
        expect(next.open).toEqual(['A.md', 'B.md']);
        expect(next.active).toBe('B.md');
    });

    it('withActive sets the active id', () => {
        expect(withActive(base, 'B.md').active).toBe('B.md');
    });

    it('withActive is a no-op for an id that is not open', () => {
        expect(withActive(base, 'ghost.md')).toEqual(base);
    });

    it('withClosed removes the id and activates the right neighbor when closing active', () => {
        const next = withClosed(base, 'A.md');
        expect(next.open).toEqual(['B.md']);
        expect(next.active).toBe('B.md');
    });

    it('withClosed activates the left neighbor when closing the last (active) tab', () => {
        const next = withClosed({...base, active: 'B.md'}, 'B.md');
        expect(next.open).toEqual(['A.md']);
        expect(next.active).toBe('A.md');
    });

    it('withClosed leaves active null when closing the only tab', () => {
        const next = withClosed(
            {version: 1, sort: 'updated', pinned: [], created: {}, open: ['A.md'], active: 'A.md'},
            'A.md',
        );
        expect(next.open).toEqual([]);
        expect(next.active).toBeNull();
    });

    it('withClosed keeps active when closing a non-active tab', () => {
        const next = withClosed(base, 'B.md');
        expect(next.open).toEqual(['A.md']);
        expect(next.active).toBe('A.md');
    });

    it('withRenamed remaps open entries and active', () => {
        const next = withRenamed(base, 'A.md', 'A2.md');
        expect(next.open).toEqual(['A2.md', 'B.md']);
        expect(next.active).toBe('A2.md');
    });

    it('withRemoved drops the id from open and reactivates a neighbor', () => {
        const next = withRemoved(base, 'A.md');
        expect(next.open).toEqual(['B.md']);
        expect(next.active).toBe('B.md');
    });

    it('reconcile drops open ids that are not live and clamps active', () => {
        const next = reconcile(base, ['B.md']);
        expect(next.open).toEqual(['B.md']);
        expect(next.active).toBe('B.md');
    });

    it('reconcile clamps active to null when nothing is live', () => {
        const next = reconcile(base, []);
        expect(next.open).toEqual([]);
        expect(next.active).toBeNull();
    });
});
