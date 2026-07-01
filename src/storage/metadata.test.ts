import {describe, expect, it} from 'vitest';

import {
    DEFAULT_METADATA,
    METADATA_FILENAME,
    orderNotes,
    parseMetadata,
    reconcile,
    withActive,
    withCreatedStamp,
    withIcon,
    withPinToggled,
    withRemoved,
    withRenamed,
    withReprefixed,
    withSortMode,
    withTrashEmptied,
    withTrashed,
    withoutTrashEntry,
} from './metadata';
import type {NoteMeta, TrashEntry} from './types';

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

    it('returns defaults for a missing or below-1 version', () => {
        expect(parseMetadata({sort: 'title', pinned: [], created: {}})).toEqual(DEFAULT_METADATA);
        expect(parseMetadata({version: 0, sort: 'title', pinned: ['A.md'], created: {}})).toEqual(
            DEFAULT_METADATA,
        );
    });

    it('parses a future version leniently, keeping its known fields', () => {
        // A newer build may bump `version`; don't nuke its pins/created/active/trash and re-write
        // them away — read every field we recognize. (We normalize the in-memory version to 1.)
        const parsed = parseMetadata({
            version: 2,
            sort: 'title',
            pinned: ['A.md', 'B.md'],
            created: {'A.md': 100},
            active: 'A.md',
            trashed: [{id: '.trash/X.md', title: 'X', originalPath: 'Work', trashedAt: 5}],
        });
        expect(parsed.pinned).toEqual(['A.md', 'B.md']);
        expect(parsed.created).toEqual({'A.md': 100});
        expect(parsed.active).toBe('A.md');
        expect(parsed.trashed).toEqual([
            {id: '.trash/X.md', title: 'X', originalPath: 'Work', trashedAt: 5},
        ]);
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

    it('defaults active to null when absent', () => {
        const parsed = parseMetadata({version: 1, sort: 'updated', pinned: [], created: {}});
        expect(parsed.active).toBeNull();
    });

    it('keeps a valid active id and nulls a non-string one', () => {
        expect(
            parseMetadata({version: 1, sort: 'updated', pinned: [], created: {}, active: 'B.md'})
                .active,
        ).toBe('B.md');
        expect(
            parseMetadata({version: 1, sort: 'updated', pinned: [], created: {}, active: 7}).active,
        ).toBeNull();
    });

    it('does not share references with DEFAULT_METADATA', () => {
        const parsed = parseMetadata({});
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
        icons: {'A.md': 'Star'},
        active: 'A.md',
        trashed: [],
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

    it('withRenamed migrates pin membership, the created entry, and the icon', () => {
        const next = withRenamed(base, 'A.md', 'A2.md');
        expect(next.pinned).toEqual(['A2.md']);
        expect(next.created).toEqual({'A2.md': 1});
        expect(next.icons).toEqual({'A2.md': 'Star'});
    });

    it('withRenamed is a no-op when the id is unchanged', () => {
        expect(withRenamed(base, 'A.md', 'A.md')).toEqual(base);
    });

    it('withRemoved drops the id from pinned, created, and icons', () => {
        const next = withRemoved(base, 'A.md');
        expect(next.pinned).toEqual([]);
        expect(next.created).toEqual({});
        expect(next.icons).toEqual({});
    });

    it('withIcon sets, updates, and clears an icon', () => {
        const withNone = {...base, icons: {}};
        const set = withIcon(withNone, 'A.md', 'Star');
        expect(set.icons).toEqual({'A.md': 'Star'});
        const updated = withIcon(set, 'A.md', 'File');
        expect(updated.icons).toEqual({'A.md': 'File'});
        const cleared = withIcon(updated, 'A.md', '');
        expect(cleared.icons).toEqual({});
    });

    it('withIcon stores an emoji character verbatim', () => {
        const set = withIcon({...base, icons: {}}, 'A.md', '⭐');
        expect(set.icons).toEqual({'A.md': '⭐'});
        // Round-trips through parse (opaque string value, keyed by note id).
        expect(parseMetadata({...set, version: 1}).icons).toEqual({'A.md': '⭐'});
    });

    it('withIcon is a no-op when clearing an unset id', () => {
        const withNone = {...base, icons: {}};
        expect(withIcon(withNone, 'Z.md', '')).toBe(withNone);
    });

    it('withIcon is a no-op when setting the same value', () => {
        expect(withIcon(base, 'A.md', 'Star')).toBe(base);
    });
});

describe('active transforms', () => {
    const base = {
        version: 1,
        sort: 'updated',
        pinned: [],
        created: {},
        icons: {},
        active: 'A.md',
        trashed: [],
    } as const;

    it('withActive sets the active id', () => {
        expect(withActive(base, 'B.md').active).toBe('B.md');
    });

    it('withActive(null) clears the active id', () => {
        expect(withActive(base, null).active).toBeNull();
    });

    it('withRenamed remaps the active id', () => {
        const next = withRenamed(base, 'A.md', 'A2.md');
        expect(next.active).toBe('A2.md');
    });

    it('withRenamed leaves a non-active id alone', () => {
        const next = withRenamed({...base, active: 'B.md'}, 'A.md', 'A2.md');
        expect(next.active).toBe('B.md');
    });

    it('withRemoved clears active when the removed id was active', () => {
        expect(withRemoved(base, 'A.md').active).toBeNull();
    });

    it('withRemoved keeps active when removing a different id', () => {
        expect(withRemoved(base, 'Z.md').active).toBe('A.md');
    });
});

describe('reconcile', () => {
    it('drops pinned/created entries for ids that are not live and clears a dead active', () => {
        const meta = {
            version: 1,
            sort: 'updated',
            pinned: ['A.md', 'ghost.md'],
            created: {'A.md': 1, 'ghost.md': 2},
            icons: {},
            active: 'ghost.md',
            trashed: [],
        } as const;
        const next = reconcile(meta, ['A.md', 'B.md']);
        expect(next.pinned).toEqual(['A.md']);
        expect(next.created).toEqual({'A.md': 1});
        expect(next.active).toBeNull();
    });

    it('keeps a live active id', () => {
        const meta = {
            version: 1,
            sort: 'updated',
            pinned: [],
            created: {},
            icons: {},
            active: 'A.md',
            trashed: [],
        } as const;
        expect(reconcile(meta, ['A.md']).active).toBe('A.md');
    });

    it('prunes a nested id absent from the live set when the backend lists recursively', () => {
        const meta = {
            version: 1,
            sort: 'updated',
            pinned: ['Work/Roadmap.md', 'gone.md'],
            created: {'Work/Roadmap.md': 1, 'gone.md': 2},
            icons: {},
            active: 'Work/Roadmap.md',
            trashed: [],
        } as const;
        // recursive listing => an absent nested id is genuinely dead and gets pruned.
        const next = reconcile(meta, ['Inbox.md'], {recursive: true});
        expect(next.pinned).toEqual([]);
        expect(next.created).toEqual({});
        expect(next.active).toBeNull();
    });

    it('keeps nested ids a non-recursive backend cannot see, while still pruning dead root ids', () => {
        const meta = {
            version: 1,
            sort: 'updated',
            pinned: ['Work/Roadmap.md', 'gone.md', 'Inbox.md'],
            created: {'Work/Roadmap.md': 1, 'gone.md': 2, 'Inbox.md': 3},
            icons: {},
            active: 'Work/Roadmap.md',
            trashed: [],
        } as const;
        // Non-recursive backend only sees top-level 'Inbox.md'. The nested pin/created/active must
        // survive (the backend can't prove them dead); the dead *root* id 'gone.md' is still pruned.
        const next = reconcile(meta, ['Inbox.md'], {recursive: false});
        expect(next.pinned).toEqual(['Work/Roadmap.md', 'Inbox.md']);
        expect(next.created).toEqual({'Work/Roadmap.md': 1, 'Inbox.md': 3});
        expect(next.active).toBe('Work/Roadmap.md');
    });

    it('prunes dead icon entries', () => {
        const meta = {
            version: 1,
            sort: 'updated',
            pinned: [],
            created: {},
            icons: {'A.md': 'Star', 'ghost.md': 'File'},
            active: null,
            trashed: [],
        } as const;
        const next = reconcile(meta, ['A.md']);
        expect(next.icons).toEqual({'A.md': 'Star'});
    });
});

describe('orderNotes', () => {
    const notes = [
        note('B.md', 'Beta', 300),
        note('A.md', 'Alpha', 100),
        note('C.md', 'Charlie', 200),
    ];

    it('sorts by updated (newest first) by default', () => {
        expect(orderNotes(notes, {...DEFAULT_METADATA}).map((n) => n.id)).toEqual([
            'B.md',
            'C.md',
            'A.md',
        ]);
    });

    it('sorts by title A→Z', () => {
        const meta = {...DEFAULT_METADATA, sort: 'title' as const};
        expect(orderNotes(notes, meta).map((n) => n.title)).toEqual(['Alpha', 'Beta', 'Charlie']);
    });

    it('sorts by title Z→A', () => {
        const meta = {...DEFAULT_METADATA, sort: 'title-desc' as const};
        expect(orderNotes(notes, meta).map((n) => n.title)).toEqual(['Charlie', 'Beta', 'Alpha']);
    });

    it('sorts by created (newest first), falling back to updatedAt when unstamped', () => {
        const meta = {...DEFAULT_METADATA, sort: 'created' as const, created: {'A.md': 999}};
        expect(orderNotes(notes, meta).map((n) => n.id)).toEqual(['A.md', 'B.md', 'C.md']);
    });

    it('keeps pinned notes on top, each group sorted by the active sort', () => {
        const meta = {...DEFAULT_METADATA, sort: 'title' as const, pinned: ['C.md']};
        expect(orderNotes(notes, meta).map((n) => n.id)).toEqual(['C.md', 'A.md', 'B.md']);
    });

    it('does not mutate the input array', () => {
        const input = [...notes];
        orderNotes(input, {...DEFAULT_METADATA, sort: 'title'});
        expect(input.map((n) => n.id)).toEqual(['B.md', 'A.md', 'C.md']);
    });
});

describe('withReprefixed', () => {
    it('re-homes note pins, folder pins, created stamps, and active under the moved prefix', () => {
        const meta = {
            ...DEFAULT_METADATA,
            pinned: ['Work', 'Work/Plan.md', 'Other/Keep.md'],
            created: {'Work/Plan.md': 5, 'Other/Keep.md': 7},
            active: 'Work/Plan.md',
        };
        const next = withReprefixed(meta, 'Work', 'Archive/Work');
        expect(next.pinned).toEqual(['Archive/Work', 'Archive/Work/Plan.md', 'Other/Keep.md']);
        expect(next.created).toEqual({'Archive/Work/Plan.md': 5, 'Other/Keep.md': 7});
        expect(next.active).toBe('Archive/Work/Plan.md');
    });

    it('handles a pure rename (same parent, new leaf)', () => {
        const meta = {...DEFAULT_METADATA, active: 'Work/Sub/Note.md', pinned: ['Work/Sub']};
        const next = withReprefixed(meta, 'Work/Sub', 'Work/Renamed');
        expect(next.active).toBe('Work/Renamed/Note.md');
        expect(next.pinned).toEqual(['Work/Renamed']);
    });

    it('leaves unrelated ids untouched and is a no-op when from === to', () => {
        const meta = {...DEFAULT_METADATA, pinned: ['Work/A.md', 'Wow/B.md']};
        expect(withReprefixed(meta, 'Hey', 'There').pinned).toEqual(['Work/A.md', 'Wow/B.md']);
        expect(withReprefixed(meta, 'Work', 'Work')).toBe(meta);
    });

    it('does not match a sibling that merely shares a name prefix', () => {
        // "Work" must not capture "Workshop/…".
        const meta = {...DEFAULT_METADATA, pinned: ['Workshop/A.md', 'Work/B.md']};
        const next = withReprefixed(meta, 'Work', 'Done');
        expect(next.pinned).toEqual(['Workshop/A.md', 'Done/B.md']);
    });

    it('remaps a trashed note’s recorded original folder under the moved prefix', () => {
        const meta = {
            ...DEFAULT_METADATA,
            trashed: [
                {id: '.trash/A.md', title: 'A', originalPath: 'Work/Sub', trashedAt: 5},
                {id: '.trash/B.md', title: 'B', originalPath: 'Other', trashedAt: 6},
            ],
        };
        const next = withReprefixed(meta, 'Work', 'Archive/Work');
        expect(next.trashed.map((t) => t.originalPath)).toEqual(['Archive/Work/Sub', 'Other']);
    });
});

describe('trash registry', () => {
    const entry = (id: string, originalPath = '', trashedAt = 1): TrashEntry => ({
        id,
        title: id.replace(/^\.trash\//, '').replace(/\.md$/, ''),
        originalPath,
        trashedAt,
    });

    it('parseMetadata keeps well-formed trashed entries and drops junk', () => {
        const parsed = parseMetadata({
            version: 1,
            sort: 'updated',
            pinned: [],
            created: {},
            trashed: [
                {id: '.trash/A.md', title: 'A', originalPath: 'Work', trashedAt: 10},
                {id: '.trash/B.md'}, // missing fields → coerced with defaults
                {title: 'no id'}, // no id → dropped
                'nope', // not an object → dropped
            ],
        });
        expect(parsed.trashed).toEqual([
            {id: '.trash/A.md', title: 'A', originalPath: 'Work', trashedAt: 10},
            {id: '.trash/B.md', title: '', originalPath: '', trashedAt: 0},
        ]);
    });

    it('parseMetadata round-trips a trashed entry’s optional created + icon', () => {
        // Regression: parseTrashEntry must read the icon (and created) a note carried into the Trash,
        // else a trash → reload → restore silently loses the note’s icon (restoreFromTrash keys off
        // entry.icon). Both are optional, so absent stays absent.
        const parsed = parseMetadata({
            version: 1,
            sort: 'updated',
            pinned: [],
            created: {},
            trashed: [
                {
                    id: '.trash/A.md',
                    title: 'A',
                    originalPath: 'Work',
                    trashedAt: 10,
                    created: 3,
                    icon: '⭐',
                },
                {id: '.trash/B.md', title: 'B', originalPath: '', trashedAt: 20},
            ],
        });
        expect(parsed.trashed).toEqual([
            {
                id: '.trash/A.md',
                title: 'A',
                originalPath: 'Work',
                trashedAt: 10,
                created: 3,
                icon: '⭐',
            },
            {id: '.trash/B.md', title: 'B', originalPath: '', trashedAt: 20},
        ]);
    });

    it('parseMetadata defaults trashed to [] when absent or not an array', () => {
        expect(
            parseMetadata({version: 1, sort: 'updated', pinned: [], created: {}}).trashed,
        ).toEqual([]);
        expect(
            parseMetadata({version: 1, sort: 'updated', pinned: [], created: {}, trashed: 'x'})
                .trashed,
        ).toEqual([]);
    });

    it('withTrashed records the entry (newest first) and drops the original id from pins/created/active', () => {
        const meta = {
            ...DEFAULT_METADATA,
            pinned: ['Work/A.md', 'Keep.md'],
            created: {'Work/A.md': 1, 'Keep.md': 2},
            active: 'Work/A.md',
            trashed: [entry('.trash/Old.md')],
        };
        const next = withTrashed(meta, 'Work/A.md', entry('.trash/A.md', 'Work', 99));
        expect(next.pinned).toEqual(['Keep.md']);
        expect(next.created).toEqual({'Keep.md': 2});
        expect(next.active).toBeNull();
        expect(next.trashed.map((t) => t.id)).toEqual(['.trash/A.md', '.trash/Old.md']);
    });

    it('withoutTrashEntry removes one entry by its trash id', () => {
        const meta = {...DEFAULT_METADATA, trashed: [entry('.trash/A.md'), entry('.trash/B.md')]};
        expect(withoutTrashEntry(meta, '.trash/A.md').trashed.map((t) => t.id)).toEqual([
            '.trash/B.md',
        ]);
    });

    it('withTrashEmptied clears the registry', () => {
        const meta = {...DEFAULT_METADATA, trashed: [entry('.trash/A.md')]};
        expect(withTrashEmptied(meta).trashed).toEqual([]);
    });

    it('withTrashed preserves the original created stamp on the entry, then drops it from created', () => {
        const meta = {
            ...DEFAULT_METADATA,
            created: {'A.md': 111},
            trashed: [],
        };
        const next = withTrashed(meta, 'A.md', {
            id: '.trash/A.md',
            title: 'A',
            originalPath: '',
            trashedAt: 222,
            created: meta.created['A.md'],
        });
        expect(next.created).toEqual({}); // dropped from the live created map
        expect(next.trashed[0].created).toBe(111); // but preserved on the entry for restore
    });

    it('parseMetadata round-trips a trash entry created stamp and omits it when absent', () => {
        const parsed = parseMetadata({
            version: 1,
            sort: 'updated',
            pinned: [],
            created: {},
            trashed: [
                {id: '.trash/A.md', title: 'A', originalPath: '', trashedAt: 1, created: 111},
                {id: '.trash/B.md', title: 'B', originalPath: '', trashedAt: 2},
            ],
        });
        expect(parsed.trashed[0].created).toBe(111);
        expect(parsed.trashed[1].created).toBeUndefined();
    });
});
