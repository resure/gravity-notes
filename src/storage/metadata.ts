import type {NoteMeta, NotesMetadata, SortMode, TrashEntry} from './types';

/** Sidecar file holding the folder's notes metadata. Not a `.md` file, so `list()` ignores it. */
export const METADATA_FILENAME = '.gravity-notes.json';

/** The metadata for a folder with no pins, no stamps, the default sort, nothing open, empty trash. */
export const DEFAULT_METADATA: NotesMetadata = {
    version: 1,
    sort: 'updated',
    pinned: [],
    created: {},
    active: null,
    trashed: [],
};

const SORT_MODES: readonly SortMode[] = ['updated', 'title', 'title-desc', 'created'];

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
    const trashed = Array.isArray(obj.trashed) ? obj.trashed.flatMap(parseTrashEntry) : [];
    return {version: 1, sort, pinned, created, active, trashed};
}

/** Coerce one raw trash entry to a well-formed {@link TrashEntry}; drop it (empty array) if junk. */
function parseTrashEntry(raw: unknown): TrashEntry[] {
    if (typeof raw !== 'object' || raw === null) return [];
    const obj = raw as Record<string, unknown>;
    if (typeof obj.id !== 'string' || obj.id === '') return [];
    return [
        {
            id: obj.id,
            title: typeof obj.title === 'string' ? obj.title : '',
            originalPath: typeof obj.originalPath === 'string' ? obj.originalPath : '',
            trashedAt: typeof obj.trashedAt === 'number' ? obj.trashedAt : 0,
            ...(typeof obj.created === 'number' ? {created: obj.created} : {}),
        },
    ];
}

function cloneDefault(): NotesMetadata {
    return {version: 1, sort: 'updated', pinned: [], created: {}, active: null, trashed: []};
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

/**
 * Re-prefix every id/path that is `from` or sits under `from/` so it lives under `to` instead — the
 * metadata side of a folder move/rename. Covers note pins, folder pins, created stamps, and the open
 * note, since all are plain path strings sharing the moved folder's prefix.
 */
export function withReprefixed(meta: NotesMetadata, from: string, to: string): NotesMetadata {
    if (from === to || !from) return meta;
    const prefix = from + '/';
    const remap = (id: string): string =>
        id === from || id.startsWith(prefix) ? to + id.slice(from.length) : id;
    const created: Record<string, number> = {};
    for (const [id, time] of Object.entries(meta.created)) created[remap(id)] = time;
    // A trashed note's id lives under `.trash/` (untouched), but its recorded original folder shares
    // the moved prefix — remap it so a later restore still lands in the renamed folder.
    const trashed = meta.trashed.map((t) => ({...t, originalPath: remap(t.originalPath)}));
    return {
        ...meta,
        pinned: meta.pinned.map(remap),
        created,
        active: meta.active ? remap(meta.active) : null,
        trashed,
    };
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

/**
 * Soft-delete: record a trashed note. `originalId` is the live id being trashed — dropped from pins /
 * created / active exactly like {@link withRemoved} (a trashed note is no longer a live note) — and
 * `entry` is prepended to the trash registry (newest first). The entry's `id` is the new trash id; it
 * should carry the note's prior `created` stamp (which `withRemoved` is about to drop) so a later
 * restore can reinstate it.
 */
export function withTrashed(
    meta: NotesMetadata,
    originalId: string,
    entry: TrashEntry,
): NotesMetadata {
    return {
        ...withRemoved(meta, originalId),
        trashed: [entry, ...meta.trashed.filter((t) => t.id !== entry.id)],
    };
}

/** Drop one trash entry by its trash id — used after both restore and permanent delete (purge). */
export function withoutTrashEntry(meta: NotesMetadata, trashId: string): NotesMetadata {
    return {...meta, trashed: meta.trashed.filter((t) => t.id !== trashId)};
}

/** Empty the whole trash registry. */
export function withTrashEmptied(meta: NotesMetadata): NotesMetadata {
    return {...meta, trashed: []};
}

/**
 * Drop pinned/created entries whose id is no longer a live file; null a dead active. Self-heals
 * external deletes.
 *
 * When `recursive` is false the live set is only the *top level* (the backend cannot yet enumerate
 * subdirectories), so any nested id (one containing `/`) is KEPT rather than pruned — otherwise a
 * non-recursive backend opening a folder that holds nested notes would silently strip their pins
 * from the shared sidecar. Defaults to recursive (prune freely), matching a complete live set.
 */
export function reconcile(
    meta: NotesMetadata,
    liveIds: string[],
    options?: {recursive?: boolean},
): NotesMetadata {
    const recursive = options?.recursive ?? true;
    const live = new Set(liveIds);
    const keep = (id: string) => live.has(id) || (!recursive && id.includes('/'));
    const created: Record<string, number> = {};
    for (const [id, time] of Object.entries(meta.created)) {
        if (keep(id)) created[id] = time;
    }
    const active = meta.active && keep(meta.active) ? meta.active : null;
    return {...meta, pinned: meta.pinned.filter(keep), created, active};
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
        case 'title-desc':
            return (a: NoteMeta, b: NoteMeta) => b.title.localeCompare(a.title);
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
