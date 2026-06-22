import {act, renderHook, waitFor} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import type {Note, NoteMeta} from '../storage/types';

import {useNoteSearch} from './useNoteSearch';

const NOTES: NoteMeta[] = [
    {id: 'Alpha.md', title: 'Alpha', updatedAt: 3},
    {id: 'Beta.md', title: 'Beta', updatedAt: 2},
    {id: 'Gamma beta.md', title: 'Gamma beta', updatedAt: 1},
];

/** A corpus stub (getAll + get) with spies, so we can assert how/when the corpus is read. */
function makeStore(bodies: Record<string, string> = {}) {
    const getAll = vi.fn(
        async (): Promise<Note[]> => NOTES.map((n) => ({...n, content: bodies[n.id] ?? ''})),
    );
    const get = vi.fn(async (id: string): Promise<Note> => {
        const meta = NOTES.find((n) => n.id === id);
        return {
            id,
            title: meta?.title ?? id,
            updatedAt: meta?.updatedAt,
            content: bodies[id] ?? '',
        };
    });
    return {getAll, get};
}

describe('useNoteSearch — title matching', () => {
    it('returns all notes for an empty query (original order, no corpus read)', () => {
        const store = makeStore();
        const {result} = renderHook(() => useNoteSearch(NOTES, store));
        expect(result.current.filteredNotes).toEqual(NOTES);
        expect(store.getAll).not.toHaveBeenCalled();
    });

    it('ranks title matches, preferring the prefix/word-start hit', () => {
        const store = makeStore();
        const {result} = renderHook(() => useNoteSearch(NOTES, store));
        act(() => result.current.setQuery('beta'));
        expect(result.current.filteredNotes.map((n) => n.id)).toEqual(['Beta.md', 'Gamma beta.md']);
    });

    it('returns an empty list when nothing matches', () => {
        const store = makeStore();
        const {result} = renderHook(() => useNoteSearch(NOTES, store));
        act(() => result.current.setQuery('zzz'));
        expect(result.current.filteredNotes).toEqual([]);
    });

    it('treats a whitespace-only query as empty', () => {
        const store = makeStore();
        const {result} = renderHook(() => useNoteSearch(NOTES, store));
        act(() => result.current.setQuery('   '));
        expect(result.current.filteredNotes).toEqual(NOTES);
        expect(store.getAll).not.toHaveBeenCalled();
    });

    it('exposes lowercased query terms for highlighting', () => {
        const store = makeStore();
        const {result} = renderHook(() => useNoteSearch(NOTES, store));
        act(() => result.current.setQuery('Release NOTES'));
        expect(result.current.terms).toEqual(['release', 'notes']);
    });
});

describe('useNoteSearch — full-text body matching', () => {
    it('surfaces a body-only match once the corpus loads, with a snippet', async () => {
        const store = makeStore({'Alpha.md': 'this note is all about kubernetes clusters'});
        const {result} = renderHook(() => useNoteSearch(NOTES, store));
        act(() => result.current.setQuery('kubernetes'));
        // Title-only first tick: nothing matches yet.
        expect(result.current.filteredNotes).toEqual([]);
        // Once getAll resolves, the body hit appears with its snippet.
        await waitFor(() =>
            expect(result.current.filteredNotes.map((n) => n.id)).toEqual(['Alpha.md']),
        );
        expect(result.current.snippetById.get('Alpha.md')).toContain('kubernetes');
    });

    it('reads the corpus once across multiple keystrokes (stable note list)', async () => {
        const store = makeStore({'Beta.md': 'mentions docker'});
        const {result} = renderHook(() => useNoteSearch(NOTES, store));
        act(() => result.current.setQuery('d'));
        act(() => result.current.setQuery('do'));
        act(() => result.current.setQuery('docker'));
        await waitFor(() =>
            expect(result.current.filteredNotes.map((n) => n.id)).toEqual(['Beta.md']),
        );
        expect(store.getAll).toHaveBeenCalledTimes(1);
    });

    it('refreshes incrementally when a note changes — reads only the changed note', async () => {
        const store = makeStore({'Alpha.md': 'old body'});
        const {result, rerender} = renderHook(({notes}) => useNoteSearch(notes, store), {
            initialProps: {notes: NOTES},
        });
        act(() => result.current.setQuery('alpha'));
        await waitFor(() => expect(store.getAll).toHaveBeenCalledTimes(1));
        // Bump Alpha's updatedAt → signature changes → only the changed note is re-read via get(),
        // not the whole corpus via getAll().
        const bumped = NOTES.map((n) => (n.id === 'Alpha.md' ? {...n, updatedAt: 99} : n));
        rerender({notes: bumped});
        await waitFor(() => expect(store.get).toHaveBeenCalledWith('Alpha.md'));
        expect(store.getAll).toHaveBeenCalledTimes(1);
        expect(store.get).toHaveBeenCalledTimes(1);
    });

    it('reports loading while the corpus is in flight, then clears it', async () => {
        const store = makeStore({'Alpha.md': 'all about kubernetes'});
        const {result} = renderHook(() => useNoteSearch(NOTES, store));
        expect(result.current.loading).toBe(false); // no active query → nothing to load
        act(() => result.current.setQuery('kubernetes'));
        expect(result.current.loading).toBe(true); // corpus not loaded yet
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.filteredNotes.map((n) => n.id)).toEqual(['Alpha.md']);
    });
});
