import {useMemo} from 'react';

import type {NoteMeta} from '../storage/types';
import {type BacklinkSource, buildBacklinks} from '../wikiLinks';

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
    const backlinks = useMemo(
        () =>
            currentId ? buildBacklinks(currentId, notes, corpus.contentById, corpus.linksById) : [],
        [currentId, notes, corpus.contentById, corpus.linksById],
    );

    return {backlinks, loading: currentId !== null && corpus.loading};
}
