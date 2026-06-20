import type {NoteMeta, NotesMetadata, SortMode} from './types';

/** Sidecar file holding the folder's notes metadata. Not a `.md` file, so `list()` ignores it. */
export const METADATA_FILENAME = '.gravity-notes.json';

/** The metadata for a folder with no pins, no stamps, the default sort, and nothing open. */
export const DEFAULT_METADATA: NotesMetadata = {
    version: 1,
    sort: 'updated',
    pinned: [],
    created: {},
    active: null,
};

const SORT_MODES: readonly SortMode[] = ['updated', 'title', 'created'];

/** Tolerant parse: coerce anything unexpected to defaults; never throws. */
export function parseMetadata(raw: unknown): NotesMetadata {
    if (typeof raw !== 'object' || raw === null) return cloneDefault();
    const obj = raw as Record<string, unknown>;
    if (obj.version !== 1) return cloneDefault();

    const sort = SORT_MODES.includes(obj.sort as SortMode) ? (obj.sort as SortMode) : 'updated';
    const pinned = Array.isArray(obj.pinned)
        ? obj.pinned.filter((x): x is string => typeof x === 'string')
        : [];
    const created: Record<string, number> = {};
    if (typeof obj.created === 'object' && obj.created !== null) {
        for (const [id, value] of Object.entries(obj.created as Record<string, unknown>)) {
            if (typeof value === 'number') created[id] = value;
        }
    }
    const active = typeof obj.active === 'string' ? obj.active : null;
    return {version: 1, sort, pinned, created, active};
}

function cloneDefault(): NotesMetadata {
    return {version: 1, sort: 'updated', pinned: [], created: {}, active: null};
}

export function withSortMode(meta: NotesMetadata, sort: SortMode): NotesMetadata {
    return {...meta, sort};
}

export function withPinToggled(meta: NotesMetadata, id: string): NotesMetadata {
    const pinned = meta.pinned.includes(id)
        ? meta.pinned.filter((p) => p !== id)
        : [...meta.pinned, id];
    return {...meta, pinned};
}

/** Set the single open note (pass `null` to close). */
export function withActive(meta: NotesMetadata, id: string | null): NotesMetadata {
    return {...meta, active: id};
}

export function withCreatedStamp(meta: NotesMetadata, id: string, created: number): NotesMetadata {
    if (meta.created[id] !== undefined) return meta;
    return {...meta, created: {...meta.created, [id]: created}};
}

export function withRenamed(meta: NotesMetadata, oldId: string, newId: string): NotesMetadata {
    if (oldId === newId) return meta;
    const pinned = meta.pinned.map((p) => (p === oldId ? newId : p));
    const created = {...meta.created};
    if (oldId in created) {
        created[newId] = created[oldId];
        delete created[oldId];
    }
    const active = meta.active === oldId ? newId : meta.active;
    return {...meta, pinned, created, active};
}

export function withRemoved(meta: NotesMetadata, id: string): NotesMetadata {
    const created = {...meta.created};
    delete created[id];
    return {
        ...meta,
        pinned: meta.pinned.filter((p) => p !== id),
        created,
        active: meta.active === id ? null : meta.active,
    };
}

/** Drop pinned/created entries whose id is no longer a live file; null a dead active. Self-heals external deletes. */
export function reconcile(meta: NotesMetadata, liveIds: string[]): NotesMetadata {
    const live = new Set(liveIds);
    const created: Record<string, number> = {};
    for (const [id, time] of Object.entries(meta.created)) {
        if (live.has(id)) created[id] = time;
    }
    const active = meta.active && live.has(meta.active) ? meta.active : null;
    return {...meta, pinned: meta.pinned.filter((id) => live.has(id)), created, active};
}

/** Pure ordering: pinned notes first, each group sorted by the active sort. Does not mutate input. */
export function orderNotes(notes: NoteMeta[], meta: NotesMetadata): NoteMeta[] {
    const pinnedSet = new Set(meta.pinned);
    const compare = comparatorFor(meta.sort, meta.created);
    const pinned = notes.filter((n) => pinnedSet.has(n.id)).sort(compare);
    const rest = notes.filter((n) => !pinnedSet.has(n.id)).sort(compare);
    return [...pinned, ...rest];
}

function comparatorFor(sort: SortMode, created: Readonly<Record<string, number>>) {
    switch (sort) {
        case 'title':
            return (a: NoteMeta, b: NoteMeta) => a.title.localeCompare(b.title);
        case 'created':
            return (a: NoteMeta, b: NoteMeta) => createdOf(b, created) - createdOf(a, created);
        case 'updated':
        default:
            return (a: NoteMeta, b: NoteMeta) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    }
}

function createdOf(note: NoteMeta, created: Readonly<Record<string, number>>): number {
    return created[note.id] ?? note.updatedAt ?? 0;
}
