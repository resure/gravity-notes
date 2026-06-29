import {renderHook} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import type {NoteMeta} from '../storage/types';

import type {Corpus} from './useCorpus';
import {useNoteSearch} from './useNoteSearch';

const NOTES: NoteMeta[] = [
    {id: 'Alpha.md', title: 'Alpha', updatedAt: 3},
    {id: 'Beta.md', title: 'Beta', updatedAt: 2},
    {id: 'Gamma beta.md', title: 'Gamma beta', updatedAt: 1},
];

/** A ready (or still-loading) {@link Corpus} built from id→body bodies — what `useCorpus` produces. */
function corpusOf(bodies: Record<string, string> = {}, loading = false): Corpus {
    const entries = Object.entries(bodies);
    return {
        contentById: new Map(entries),
        lowerById: new Map(entries.map(([id, body]) => [id, body.toLowerCase()])),
        linksById: new Map(),
        loading,
    };
}

describe('useNoteSearch — title matching', () => {
    it('returns all notes for an empty query (original order preserved)', () => {
        const {result} = renderHook(() => useNoteSearch(NOTES, '', corpusOf()));
        expect(result.current.filteredNotes).toEqual(NOTES);
    });

    it('ranks title matches, preferring the prefix/word-start hit', () => {
        const {result} = renderHook(() => useNoteSearch(NOTES, 'beta', corpusOf()));
        expect(result.current.filteredNotes.map((n) => n.id)).toEqual(['Beta.md', 'Gamma beta.md']);
    });

    it('returns an empty list when nothing matches', () => {
        const {result} = renderHook(() => useNoteSearch(NOTES, 'zzz', corpusOf()));
        expect(result.current.filteredNotes).toEqual([]);
    });

    it('treats a whitespace-only query as empty', () => {
        const {result} = renderHook(() => useNoteSearch(NOTES, '   ', corpusOf()));
        expect(result.current.filteredNotes).toEqual(NOTES);
    });
});

describe('useNoteSearch — full-text body matching', () => {
    it('surfaces a body-only match from the corpus, with a snippet', () => {
        const corpus = corpusOf({'Alpha.md': 'this note is all about kubernetes clusters'});
        const {result} = renderHook(() => useNoteSearch(NOTES, 'kubernetes', corpus));
        expect(result.current.filteredNotes.map((n) => n.id)).toEqual(['Alpha.md']);
        expect(result.current.snippetById.get('Alpha.md')).toContain('kubernetes');
    });

    it('is title-only (loading) until the corpus resolves, then body matches fold in', () => {
        // Corpus still loading + empty: a body-only term matches nothing yet, and loading is true.
        const {result, rerender} = renderHook(
            ({corpus}: {corpus: Corpus}) => useNoteSearch(NOTES, 'kubernetes', corpus),
            {initialProps: {corpus: corpusOf({}, true)}},
        );
        expect(result.current.loading).toBe(true);
        expect(result.current.filteredNotes).toEqual([]);
        // The corpus resolves with the body → the match appears and loading clears.
        rerender({corpus: corpusOf({'Alpha.md': 'all about kubernetes'}, false)});
        expect(result.current.loading).toBe(false);
        expect(result.current.filteredNotes.map((n) => n.id)).toEqual(['Alpha.md']);
    });

    it('never reports loading for an empty query, even while the corpus loads', () => {
        const {result} = renderHook(() => useNoteSearch(NOTES, '', corpusOf({}, true)));
        expect(result.current.loading).toBe(false);
    });
});
