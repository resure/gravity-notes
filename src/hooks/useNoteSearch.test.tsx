import {act, renderHook} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import type {NoteMeta} from '../storage/types';

import {noteMatches, useNoteSearch} from './useNoteSearch';

const NOTES: NoteMeta[] = [
    {id: 'Alpha.md', title: 'Alpha', updatedAt: 3},
    {id: 'Beta.md', title: 'Beta', updatedAt: 2},
    {id: 'Gamma beta.md', title: 'Gamma beta', updatedAt: 1},
];

describe('noteMatches', () => {
    it('matches case-insensitively on the title', () => {
        expect(noteMatches(NOTES[0], 'alp')).toBe(true);
        expect(noteMatches(NOTES[0], 'xyz')).toBe(false);
    });
});

describe('useNoteSearch', () => {
    it('returns all notes for an empty query', () => {
        const {result} = renderHook(() => useNoteSearch(NOTES));
        expect(result.current.filteredNotes).toEqual(NOTES);
    });

    it('filters by case-insensitive title substring, preserving order', () => {
        const {result} = renderHook(() => useNoteSearch(NOTES));
        act(() => result.current.setQuery('beta'));
        expect(result.current.filteredNotes.map((n) => n.id)).toEqual(['Beta.md', 'Gamma beta.md']);
    });

    it('returns an empty list when nothing matches', () => {
        const {result} = renderHook(() => useNoteSearch(NOTES));
        act(() => result.current.setQuery('zzz'));
        expect(result.current.filteredNotes).toEqual([]);
    });

    it('treats a whitespace-only query as empty', () => {
        const {result} = renderHook(() => useNoteSearch(NOTES));
        act(() => result.current.setQuery('   '));
        expect(result.current.filteredNotes).toEqual(NOTES);
    });
});
