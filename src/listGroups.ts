import type {NoteMeta, SortMode} from './storage/types';

/**
 * Time (and letter) groups for the note list — pure, no I/O, no React, like `search.ts` and
 * `tree.ts` beside it.
 *
 * §05: "Without them a scoped list is three hundred identical blocks; with them the eye has
 * somewhere to land." Two rules do all the work:
 *
 * • **Pins are the first group, not a badge.** A pinned note used to carry a glyph on its row; it
 *   now simply lives under "Pinned" at the top, which is what pinning meant all along.
 * • **Groups follow the active sort.** Sorting by date gives Today / Yesterday / Earlier; sorting by
 *   title gives A, B, C. A group label that disagreed with the order below it would be worse than
 *   no label at all.
 *
 * The list arrives already ordered (`orderNotes` in metadata.ts) — this only decides where the
 * labels fall, and never reorders anything.
 */

export type ListRow =
    | {kind: 'group'; key: string; label: string}
    | {kind: 'note'; key: string; note: NoteMeta};

export interface ListGroupOptions {
    sort: SortMode;
    pinned: readonly string[] | ReadonlySet<string>;
    /** Creation stamps from the sidecar, for the `created` sort (falls back to `updatedAt`). */
    created?: Readonly<Record<string, number>>;
    /** "Now", injected so the boundaries are testable. Defaults to the wall clock. */
    now?: number;
}

/** The label a note belongs under, given the active sort. Pins are handled by the caller. */
function labelFor(note: NoteMeta, options: ListGroupOptions, now: number): string {
    if (options.sort === 'title' || options.sort === 'title-desc') {
        const first = note.title.trim().charAt(0).toUpperCase();
        // Anything that isn't a letter — digits, punctuation, emoji — shares one bucket, the way a
        // physical index does. `toLowerCase` differing from the char is a cheap letter test that
        // holds for Cyrillic as well as Latin, which matters: RU titles are first-class here.
        return first && first.toLowerCase() !== first ? first : '#';
    }
    const stamp =
        options.sort === 'created'
            ? (options.created?.[note.id] ?? note.updatedAt ?? 0)
            : (note.updatedAt ?? 0);
    if (!stamp) return 'Earlier';
    const days = daysBetween(stamp, now);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    return 'Earlier';
}

/** Whole calendar days from `then` to `now`, in local time (not a 24h-multiples division). */
function daysBetween(then: number, now: number): number {
    const a = new Date(then);
    const b = new Date(now);
    const startA = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
    const startB = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
    return Math.round((startB - startA) / 86400000);
}

/**
 * Interleave group labels into an already-ordered note list.
 *
 * `grouped: false` (a live search) returns the notes alone: search results are ranked by relevance,
 * so there is no active sort for a label to follow, and "Today" over a relevance-ordered list would
 * be a lie about the order.
 */
export function buildListRows(
    notes: readonly NoteMeta[],
    options: ListGroupOptions & {grouped?: boolean},
): ListRow[] {
    if (options.grouped === false) {
        return notes.map((note) => ({kind: 'note', key: note.id, note}));
    }
    const pinned = options.pinned instanceof Set ? options.pinned : new Set(options.pinned);
    const now = options.now ?? Date.now();
    const rows: ListRow[] = [];
    let current: string | null = null;
    for (const note of notes) {
        const label = pinned.has(note.id) ? 'Pinned' : labelFor(note, options, now);
        if (label !== current) {
            current = label;
            rows.push({kind: 'group', key: `group:${label}`, label});
        }
        rows.push({kind: 'note', key: note.id, note});
    }
    return rows;
}
