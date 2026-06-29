import {useMemo} from 'react';

import type {NoteMeta} from '../storage/types';
import {type BacklinkSource, buildBacklinkIndex} from '../wikiLinks';

import type {Corpus} from './useCorpus';

export interface UseBacklinks {
    /** Notes that link to the open note via a `[[wiki link]]`, with context (most-recent first). */
    backlinks: BacklinkSource[];
    /** True while the body corpus for the current note list is still loading (results may be partial). */
    loading: boolean;
}

/**
 * Backlinks for the open note, computed from the shared {@link Corpus} (loaded once by `useCorpus`).
 * The graph inversion is the pure `buildBacklinks`, which reads the corpus's pre-extracted per-note
 * `[[wiki links]]` (`linksById`) instead of re-scanning every body with the link regex on each open —
 * so switching the open note only re-resolves the (already-parsed) links, not the whole corpus.
 */
export function useBacklinks(
    notes: NoteMeta[],
    currentId: string | null,
    corpus: Corpus,
): UseBacklinks {
    // Invert the link graph ONCE per corpus/notes change (NOT per open): this memo's deps deliberately
    // exclude `currentId`, so switching the open note doesn't rebuild the index — it just looks up.
    const index = useMemo(
        () => buildBacklinkIndex(notes, corpus.contentById, corpus.linksById),
        [notes, corpus.contentById, corpus.linksById],
    );
    // O(1) per open: pull the target's pre-sorted bucket out of the warm index.
    const backlinks = useMemo<BacklinkSource[]>(
        () => (currentId ? (index.get(currentId) ?? []) : []),
        [currentId, index],
    );

    return {backlinks, loading: currentId !== null && corpus.loading};
}
