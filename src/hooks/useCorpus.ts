import {useEffect, useMemo, useRef, useState} from 'react';

import type {NoteMeta, NoteStore} from '../storage/types';
import {type WikiLinkRef, extractWikiLinks} from '../wikiLinks';

/**
 * The lazily-loaded full-text body corpus, shared by full-text search and backlinks. Both features
 * need every note's body, so loading it twice (once per hook) would double the `getAll()` read — one
 * giant IPC payload on the desktop backend — and hold two copies of every body in memory. This hook
 * owns a single load + cache, and derives the per-feature indices each consumer needs:
 *
 *  - `contentById` — the raw body (case preserved), for snippet slicing.
 *  - `lowerById`   — the body pre-lowercased once, so search never re-lowercases the corpus on a
 *                    keystroke (the dominant avoidable cost on a large folder).
 *  - `linksById`   — each body's `[[wiki links]]` pre-extracted once, so backlinks never re-scans
 *                    every body with the link regex on each note open.
 *
 * All three are computed once per note, when it's read — never per keystroke or per open. The corpus
 * is loaded only while `active`, refreshed *incrementally* (re-reading only notes whose `updatedAt`
 * changed), and dropped when the backend changes.
 */

/** Order-independent fingerprint of the note list (id + last-modified). The corpus reloads only when
 * this changes — a note's content/identity changed — not on a re-sort, re-pin, or keystroke. */
function listSignature(notes: NoteMeta[]): string {
    return notes
        .map((n) => `${n.id}:${n.updatedAt ?? 0}`)
        .sort()
        .join('\n');
}

/** One cached note body + its derived indices, tagged with the `updatedAt` it was read at. */
interface CorpusEntry {
    updatedAt: number;
    content: string;
    lower: string;
    links: WikiLinkRef[];
}

function entryFor(content: string, updatedAt: number): CorpusEntry {
    return {updatedAt, content, lower: content.toLowerCase(), links: extractWikiLinks(content)};
}

export interface Corpus {
    /** Note id → raw body (case preserved). */
    contentById: Map<string, string>;
    /** Note id → body pre-lowercased once (search scores against this). */
    lowerById: Map<string, string>;
    /** Note id → the body's `[[wiki links]]`, pre-extracted once (backlinks scan this). */
    linksById: Map<string, WikiLinkRef[]>;
    /** True while a query/open is active but the corpus doesn't yet reflect the current note list. */
    loading: boolean;
}

/** The slice of `NoteStore` the corpus needs (kept narrow so tests can pass a stub). */
type CorpusSource = Pick<NoteStore, 'getAll' | 'get'>;

/**
 * Load + cache the body corpus while `active`, exposing the derived search/backlink indices. Pass
 * `active = a query is live OR a note is open`, so the (potentially large) read only happens when a
 * feature actually needs the bodies.
 */
export function useCorpus(store: CorpusSource, notes: NoteMeta[], active: boolean): Corpus {
    const [corpus, setCorpus] = useState<Map<string, CorpusEntry>>(() => new Map());
    // The signature the corpus reflects; drives both the reload guard and the `loading` flag.
    const [loadedSignature, setLoadedSignature] = useState<string | null>(null);
    const loadingRef = useRef(false);

    const signature = useMemo(() => listSignature(notes), [notes]);

    // Read notes/corpus through refs inside the load effect so they aren't effect deps (which would
    // re-run it on every list churn); the `signature` guard governs when work actually happens.
    const notesRef = useRef(notes);
    notesRef.current = notes;
    const corpusRef = useRef(corpus);
    corpusRef.current = corpus;

    // Drop the cached corpus when the backend changes, so neither consumer serves another store's notes.
    useEffect(() => {
        loadingRef.current = false;
        setLoadedSignature(null);
        setCorpus(new Map());
    }, [store]);

    // (Re)load the corpus while active. Deps are intentionally just activation, the list signature,
    // the store, and the loaded signature — not `notes`/`corpus` (read via refs) — so typing more
    // characters / switching the open note reuses the cache instead of re-reading every note.
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
                    for (const n of all) next.set(n.id, entryFor(n.content, n.updatedAt ?? 0));
                } else {
                    // Incremental: re-read only notes whose updatedAt changed (or are new); reuse the
                    // rest, and drop any that vanished. Avoids a full re-scan when one note is edited.
                    const stale = currentNotes.filter(
                        (n) => cached.get(n.id)?.updatedAt !== (n.updatedAt ?? 0),
                    );
                    const fetched = await Promise.all(
                        stale.map((n) =>
                            store.get(n.id).then(
                                (loaded) => ({
                                    id: n.id,
                                    content: loaded.content,
                                    at: loaded.updatedAt ?? 0,
                                }),
                                () => null, // a note vanished mid-read — skip it
                            ),
                        ),
                    );
                    if (cancelled) return;
                    next = new Map(cached);
                    const present = new Set(currentNotes.map((n) => n.id));
                    for (const id of [...next.keys()]) if (!present.has(id)) next.delete(id);
                    for (const f of fetched) if (f) next.set(f.id, entryFor(f.content, f.at));
                }
                setCorpus(next);
                setLoadedSignature(signature);
            } catch {
                // A corpus read failure degrades both features (title-only search, no backlinks).
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

    const lowerById = useMemo(() => {
        const map = new Map<string, string>();
        for (const [id, entry] of corpus) map.set(id, entry.lower);
        return map;
    }, [corpus]);

    const linksById = useMemo(() => {
        const map = new Map<string, WikiLinkRef[]>();
        for (const [id, entry] of corpus) map.set(id, entry.links);
        return map;
    }, [corpus]);

    return {contentById, lowerById, linksById, loading: active && loadedSignature !== signature};
}
