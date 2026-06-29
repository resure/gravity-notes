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
 *
 * `contentById`/`lowerById` get a fresh identity on EVERY update (search depends on body content, so
 * it must re-score when a body changes). `linksById`, by contrast, keeps its object identity across an
 * update that doesn't change any note's `[[…]]` link set — so the backlink inversion (keyed on it)
 * bails out on a plain autosave instead of rebuilding the whole link graph each save. See
 * {@link sameLinks}.
 */

/**
 * Order-independent fingerprint of the note list (id + last-modified). The corpus reloads only when
 * this changes — a note's content/identity changed — not on a re-sort, re-pin, or keystroke.
 */
function listSignature(notes: NoteMeta[]): string {
    return notes
        .map((n) => `${n.id}:${n.updatedAt ?? 0}`)
        .sort()
        .join('\n');
}

/**
 * One cached note body + its lowercased form, tagged with the `updatedAt` it was read at. (Wiki links
 * are kept in a SEPARATE map so their identity can stay stable independently — see the hook.)
 */
interface CorpusEntry {
    updatedAt: number;
    content: string;
    lower: string;
}

const EMPTY_LINKS: WikiLinkRef[] = [];

/**
 * Structural equality of two extracted link lists (target + position). Position is included on
 * purpose: the backlink inversion stores these refs and slices context snippets at `index`, so the
 * links map must take a new identity whenever a link's position shifts — otherwise a stale position
 * would later slice a snippet at the wrong offset. (Target-only equality would leave the graph right
 * but the snippets wrong.) `undefined`/`null` are treated as the empty list.
 */
function sameLinks(a: WikiLinkRef[] | undefined, b: WikiLinkRef[] | undefined): boolean {
    const aa = a ?? EMPTY_LINKS;
    const bb = b ?? EMPTY_LINKS;
    if (aa === bb) return true;
    if (aa.length !== bb.length) return false;
    for (let i = 0; i < aa.length; i++) {
        if (
            aa[i].target !== bb[i].target ||
            aa[i].index !== bb[i].index ||
            aa[i].length !== bb[i].length
        )
            return false;
    }
    return true;
}

/**
 * Merge freshly-extracted links for the changed/added notes into the cached link index, returning a
 * NEW map ONLY when the link graph actually changed (a note vanished, or a note's `[[…]]` set/position
 * changed). Returns `null` when nothing link-relevant changed — the caller then leaves `linksById`'s
 * identity untouched, so a plain prose edit doesn't make the backlink inversion rebuild.
 *
 *  - `presentIds`  — the ids still in the note list (a missing id means the note was deleted).
 *  - `fetchedLinks`— the freshly-extracted links for just the notes re-read this update.
 */
function mergeLinkIndex(
    cachedLinks: ReadonlyMap<string, WikiLinkRef[]>,
    presentIds: ReadonlySet<string>,
    fetchedLinks: ReadonlyMap<string, WikiLinkRef[]>,
): Map<string, WikiLinkRef[]> | null {
    let changed = false;
    for (const id of cachedLinks.keys()) {
        if (!presentIds.has(id)) {
            changed = true; // a note (and its outgoing links) vanished
            break;
        }
    }
    if (!changed) {
        for (const [id, extracted] of fetchedLinks) {
            if (!sameLinks(cachedLinks.get(id), extracted)) {
                changed = true;
                break;
            }
        }
    }
    if (!changed) return null;
    const next = new Map(cachedLinks);
    for (const id of [...next.keys()]) if (!presentIds.has(id)) next.delete(id);
    for (const [id, extracted] of fetchedLinks) next.set(id, extracted);
    return next;
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
    // content/lower entries (search indices). Fresh identity on every update — search needs that.
    const [corpus, setCorpus] = useState<Map<string, CorpusEntry>>(() => new Map());
    // The wiki-link index is held SEPARATELY so it can keep a stable identity across an update that
    // touches only prose (no `[[…]]` change): the backlink inversion keys on this map's identity.
    const [linksById, setLinksById] = useState<Map<string, WikiLinkRef[]>>(() => new Map());
    // The signature the corpus reflects; drives both the reload guard and the `loading` flag.
    const [loadedSignature, setLoadedSignature] = useState<string | null>(null);
    const loadingRef = useRef(false);

    const signature = useMemo(() => listSignature(notes), [notes]);

    // Read notes/corpus/links through refs inside the load effect so they aren't effect deps (which
    // would re-run it on every list churn); the `signature` guard governs when work actually happens.
    const notesRef = useRef(notes);
    notesRef.current = notes;
    const corpusRef = useRef(corpus);
    corpusRef.current = corpus;
    const linksRef = useRef(linksById);
    linksRef.current = linksById;

    // Drop the cached corpus when the backend changes, so neither consumer serves another store's notes.
    useEffect(() => {
        loadingRef.current = false;
        setLoadedSignature(null);
        setCorpus(new Map());
        setLinksById(new Map());
    }, [store]);

    // (Re)load the corpus while active. Deps are intentionally just activation, the list signature,
    // the store, and the loaded signature — not `notes`/`corpus`/`links` (read via refs) — so typing
    // more characters / switching the open note reuses the cache instead of re-reading every note.
    useEffect(() => {
        if (!active) return undefined;
        if (loadingRef.current || loadedSignature === signature) return undefined;
        let cancelled = false;
        loadingRef.current = true;
        const cachedCorpus = corpusRef.current;
        const cachedLinks = linksRef.current;
        const currentNotes = notesRef.current;
        void (async () => {
            try {
                let nextCorpus: Map<string, CorpusEntry>;
                let nextLinks: Map<string, WikiLinkRef[]> | null = null;
                if (cachedCorpus.size === 0) {
                    // First read for this store/session: one bulk pass over every note.
                    const all = await store.getAll();
                    if (cancelled) return;
                    nextCorpus = new Map();
                    const links = new Map<string, WikiLinkRef[]>();
                    for (const n of all) {
                        const {content} = n;
                        nextCorpus.set(n.id, {
                            updatedAt: n.updatedAt ?? 0,
                            content,
                            lower: content.toLowerCase(),
                        });
                        links.set(n.id, extractWikiLinks(content));
                    }
                    nextLinks = links; // a fresh load always publishes the link index
                } else {
                    // Incremental: re-read only notes whose updatedAt changed (or are new); reuse the
                    // rest, and drop any that vanished. Avoids a full re-scan when one note is edited.
                    const stale = currentNotes.filter(
                        (n) => cachedCorpus.get(n.id)?.updatedAt !== (n.updatedAt ?? 0),
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
                    nextCorpus = new Map(cachedCorpus);
                    const present = new Set(currentNotes.map((n) => n.id));
                    for (const id of [...nextCorpus.keys()])
                        if (!present.has(id)) nextCorpus.delete(id);

                    // Refresh each re-read note's content/lower entry (search must re-score it), and
                    // collect its freshly-extracted links. Then merge those into the cached link index:
                    // a NEW links map is published ONLY when the graph changed, so a plain prose edit
                    // keeps linksById's identity and the backlink inversion bails out.
                    const fetchedLinks = new Map<string, WikiLinkRef[]>();
                    for (const f of fetched) {
                        if (!f) continue;
                        nextCorpus.set(f.id, {
                            updatedAt: f.at,
                            content: f.content,
                            lower: f.content.toLowerCase(),
                        });
                        fetchedLinks.set(f.id, extractWikiLinks(f.content));
                    }
                    nextLinks = mergeLinkIndex(cachedLinks, present, fetchedLinks);
                    // else: leave linksById untouched (stable identity) — the graph didn't change.
                }
                setCorpus(nextCorpus);
                if (nextLinks) setLinksById(nextLinks);
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

    return {contentById, lowerById, linksById, loading: active && loadedSignature !== signature};
}
