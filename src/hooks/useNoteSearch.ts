import {useMemo} from 'react';

import {searchNotes} from '../search';
import type {NoteMeta} from '../storage/types';

import type {Corpus} from './useCorpus';

export interface UseNoteSearch {
    /** `notes` filtered + ranked by `query`; the original order when the query is empty. */
    filteredNotes: NoteMeta[];
    /** Note id → body snippet around the match, when the match is in the body. */
    snippetById: Map<string, string>;
    /**
     * True while a query is active but the body corpus for the current note list hasn't loaded yet —
     * so results are still title-only and body matches may still appear. Callers should not treat an
     * empty `filteredNotes` as "no match" while this is true (see TopBar's find-or-create).
     */
    loading: boolean;
}

/**
 * Derives the ranked, filtered note list for `query`. Full-text: it scores against the shared
 * {@link Corpus} (loaded once by `useCorpus`), using the corpus's pre-lowercased bodies so a big
 * folder isn't re-lowercased on every keystroke. Title matches render immediately; body matches and
 * snippets fold in once the corpus resolves. Stateless beyond memoization — the query string and the
 * corpus are owned by the caller (Workspace), so search and backlinks share one corpus load.
 */
export function useNoteSearch(notes: NoteMeta[], query: string, corpus: Corpus): UseNoteSearch {
    const active = query.trim().length > 0;

    const results = useMemo(
        () => (active ? searchNotes(notes, corpus.contentById, query, corpus.lowerById) : null),
        [active, notes, corpus.contentById, corpus.lowerById, query],
    );

    const filteredNotes = useMemo(
        () => (results ? results.map((r) => r.note) : notes),
        [results, notes],
    );

    const snippetById = useMemo(() => {
        const map = new Map<string, string>();
        if (results) {
            for (const r of results) if (r.snippet) map.set(r.note.id, r.snippet);
        }
        return map;
    }, [results]);

    // Title-only results until the corpus reflects the current list (then body matches fold in).
    return {filteredNotes, snippetById, loading: active && corpus.loading};
}
