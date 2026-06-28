import {useEffect, useMemo, useRef, useState} from 'react';

import {searchNotes, tokenizeQuery} from '../search';
import type {NoteMeta, NoteStore} from '../storage/types';

/**
 * Order-independent fingerprint of the note list (id + last-modified of each note). The full-text
 * corpus is refreshed only when this changes — i.e. a note's content/identity changed — not on a
 * mere re-sort or re-pin, and not on every keystroke.
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

export interface UseNoteSearch {
    query: string;
    setQuery: (query: string) => void;
    /** `notes` filtered + ranked by `query`; the original order when the query is empty. */
    filteredNotes: NoteMeta[];
    /** Lowercased query terms, for match highlighting. */
    terms: string[];
    /** Note id → body snippet around the match, when the match is in the body. */
    snippetById: Map<string, string>;
    /**
     * True while a query is active but the body corpus for the current note list hasn't loaded yet —
     * so results are still title-only and body matches may still appear. Callers should not treat an
     * empty `filteredNotes` as "no match" while this is true (see TopBar's find-or-create).
     */
    loading: boolean;
}

/** The slice of `NoteStore` the search corpus needs (kept narrow so tests can pass a stub). */
type CorpusSource = Pick<NoteStore, 'getAll' | 'get'>;

/**
 * Owns the search query and derives the ranked, filtered note list. Full-text: while a query is
 * active it lazily loads every note's body once (via `store.getAll()`), caches it, and afterwards
 * refreshes *incrementally* — re-reading only the notes whose `updatedAt` changed (via `store.get`),
 * so editing one note while a search is open doesn't trigger a full corpus re-scan. Title matches
 * render immediately; body matches and snippets fold in a tick later when the corpus resolves.
 */
export function useNoteSearch(notes: NoteMeta[], store: CorpusSource): UseNoteSearch {
    const [query, setQuery] = useState('');
    const [corpus, setCorpus] = useState<Map<string, CorpusEntry>>(() => new Map());
    // The signature the corpus reflects; drives both the reload guard and the `loading` flag.
    const [loadedSignature, setLoadedSignature] = useState<string | null>(null);
    const loadingRef = useRef(false);

    const active = query.trim().length > 0;
    const signature = useMemo(() => listSignature(notes), [notes]);

    // Read notes/corpus through refs inside the load effect so they don't need to be effect deps
    // (which would re-run it on every list churn); the `signature` guard governs when work happens.
    const notesRef = useRef(notes);
    notesRef.current = notes;
    const corpusRef = useRef(corpus);
    corpusRef.current = corpus;

    // Drop the cached corpus when the backend changes, so search never serves another store's notes.
    useEffect(() => {
        loadingRef.current = false;
        setLoadedSignature(null);
        setCorpus(new Map());
    }, [store]);

    // (Re)load the body corpus while a query is active. Deps are intentionally just the activation,
    // the list signature, the store, and the loaded signature — not `notes`/`corpus` (read via refs)
    // — so typing more characters reuses the cache instead of re-reading every note.
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
                    // rest. Avoids a full corpus re-scan when one note is edited mid-search.
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
                // A corpus read failure degrades search to title-only; nothing user-facing to show.
                // Mark the attempt resolved (accept the possibly-partial/empty corpus) so `loading`
                // clears — otherwise it sticks true forever and swallows the nvALT Enter-to-create.
                if (!cancelled) setLoadedSignature(signature);
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

    const results = useMemo(
        () => (active ? searchNotes(notes, contentById, query) : null),
        [active, notes, contentById, query],
    );

    const filteredNotes = useMemo(
        () => (results ? results.map((r) => r.note) : notes),
        [results, notes],
    );

    const terms = useMemo(() => tokenizeQuery(query), [query]);

    const snippetById = useMemo(() => {
        const map = new Map<string, string>();
        if (results) {
            for (const r of results) if (r.snippet) map.set(r.note.id, r.snippet);
        }
        return map;
    }, [results]);

    return {
        query,
        setQuery,
        filteredNotes,
        terms,
        snippetById,
        loading: active && loadedSignature !== signature,
    };
}
