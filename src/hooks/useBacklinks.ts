import {useEffect, useMemo, useRef, useState} from 'react';

import type {NoteMeta, NoteStore} from '../storage/types';
import {type BacklinkSource, buildBacklinks} from '../wikiLinks';

/**
 * Order-independent fingerprint of the note list (id + last-modified of each note). The body corpus
 * is refreshed only when this changes — i.e. some note's content/identity changed — not on a re-sort
 * or re-pin. Mirrors `useNoteSearch`'s corpus signature.
 */
function listSignature(notes: NoteMeta[]): string {
    return notes
        .map((n) => `${n.id}:${n.updatedAt ?? 0}`)
        .sort()
        .join('\n');
}

/** One cached note body, tagged with the `updatedAt` it was read at (for incremental refresh). */
interface CorpusEntry {
    updatedAt: number;
    content: string;
}

/** The slice of `NoteStore` the corpus needs (kept narrow so tests can pass a stub). */
type CorpusSource = Pick<NoteStore, 'getAll' | 'get'>;

export interface UseBacklinks {
    /** Notes that link to the open note via a `[[wiki link]]`, with context (most-recent first). */
    backlinks: BacklinkSource[];
    /** True while the body corpus for the current note list is still loading (results may be partial). */
    loading: boolean;
}

/**
 * Backlinks for the open note. While a note is open it lazily loads every note's body once (via
 * `store.getAll()`), caches it, and afterwards refreshes *incrementally* — re-reading only the notes
 * whose `updatedAt` changed (via `store.get`) — so editing one note doesn't trigger a full re-scan.
 * The graph inversion itself is the pure `buildBacklinks`, recomputed when the open note, the list, or
 * the corpus changes. Mirrors `useNoteSearch`'s corpus lifecycle; takes the same narrow store slice.
 */
export function useBacklinks(
    store: CorpusSource,
    notes: NoteMeta[],
    currentId: string | null,
): UseBacklinks {
    const [corpus, setCorpus] = useState<Map<string, CorpusEntry>>(() => new Map());
    const [loadedSignature, setLoadedSignature] = useState<string | null>(null);
    const loadingRef = useRef(false);

    const active = currentId !== null; // only keep a corpus warm while a note is open
    const signature = useMemo(() => listSignature(notes), [notes]);

    // Read notes/corpus through refs inside the load effect so they aren't effect deps (which would
    // re-run it on every list churn); the `signature` guard governs when work actually happens.
    const notesRef = useRef(notes);
    notesRef.current = notes;
    const corpusRef = useRef(corpus);
    corpusRef.current = corpus;

    // Drop the cached corpus when the backend changes, so backlinks never serve another store's notes.
    useEffect(() => {
        loadingRef.current = false;
        setLoadedSignature(null);
        setCorpus(new Map());
    }, [store]);

    useEffect(() => {
        if (!active) return undefined;
        if (loadingRef.current || loadedSignature === signature) return undefined;
        let cancelled = false;
        loadingRef.current = true;
        const cached = corpusRef.current;
        const currentNotes = notesRef.current;
        void (async () => {
            try {
                let next: Map<string, CorpusEntry>;
                if (cached.size === 0) {
                    // First read for this store/session: one bulk pass over every note.
                    const all = await store.getAll();
                    if (cancelled) return;
                    next = new Map();
                    for (const n of all)
                        next.set(n.id, {updatedAt: n.updatedAt ?? 0, content: n.content});
                } else {
                    // Incremental: re-read only notes whose updatedAt changed (or are new); reuse the
                    // rest, and drop any that vanished.
                    const stale = currentNotes.filter(
                        (n) => cached.get(n.id)?.updatedAt !== (n.updatedAt ?? 0),
                    );
                    const fetched = await Promise.all(
                        stale.map((n) =>
                            store.get(n.id).then(
                                (loaded) => ({
                                    id: n.id,
                                    updatedAt: loaded.updatedAt ?? 0,
                                    content: loaded.content,
                                }),
                                () => null, // a note vanished mid-read — skip it
                            ),
                        ),
                    );
                    if (cancelled) return;
                    next = new Map(cached);
                    const present = new Set(currentNotes.map((n) => n.id));
                    for (const id of [...next.keys()]) if (!present.has(id)) next.delete(id);
                    for (const f of fetched) {
                        if (f) next.set(f.id, {updatedAt: f.updatedAt, content: f.content});
                    }
                }
                setCorpus(next);
                setLoadedSignature(signature);
            } catch {
                // A corpus read failure just yields no backlinks; nothing user-facing to show.
            } finally {
                if (!cancelled) loadingRef.current = false;
            }
        })();
        return () => {
            cancelled = true;
            loadingRef.current = false;
        };
    }, [active, signature, store, loadedSignature]);

    const contentById = useMemo(() => {
        const map = new Map<string, string>();
        for (const [id, entry] of corpus) map.set(id, entry.content);
        return map;
    }, [corpus]);

    const backlinks = useMemo(
        () => (currentId ? buildBacklinks(currentId, notes, contentById) : []),
        [currentId, notes, contentById],
    );

    return {backlinks, loading: active && loadedSignature !== signature};
}
