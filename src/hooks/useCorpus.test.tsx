import {renderHook, waitFor} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import type {Note, NoteMeta} from '../storage/types';

import {useCorpus} from './useCorpus';

const NOTES: NoteMeta[] = [
    {id: 'Alpha.md', title: 'Alpha', updatedAt: 3},
    {id: 'Beta.md', title: 'Beta', updatedAt: 2},
    {id: 'Gamma beta.md', title: 'Gamma beta', updatedAt: 1},
];

/** A corpus source (getAll + get) with spies, so we can assert how/when the corpus is read. */
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

describe('useCorpus — loading lifecycle', () => {
    it('does not read while inactive', () => {
        const store = makeStore();
        const {result} = renderHook(() => useCorpus(store, NOTES, false));
        expect(store.getAll).not.toHaveBeenCalled();
        expect(result.current.loading).toBe(false);
    });

    it('loads every body once when active and exposes the derived indices', async () => {
        const store = makeStore({'Alpha.md': 'About KUBERNETES and [[Beta]] notes'});
        const {result} = renderHook(() => useCorpus(store, NOTES, true));
        expect(result.current.loading).toBe(true);
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(store.getAll).toHaveBeenCalledTimes(1);
        // content (case preserved), lower (search index), links (backlink index) all derived once.
        expect(result.current.contentById.get('Alpha.md')).toContain('KUBERNETES');
        expect(result.current.lowerById.get('Alpha.md')).toContain('kubernetes');
        expect(result.current.linksById.get('Alpha.md')?.map((l) => l.target)).toEqual(['Beta']);
    });

    it('reads the corpus once across re-renders (stable note list)', async () => {
        const store = makeStore({'Beta.md': 'mentions docker'});
        const {result, rerender} = renderHook(({active}) => useCorpus(store, NOTES, active), {
            initialProps: {active: true},
        });
        await waitFor(() => expect(result.current.loading).toBe(false));
        rerender({active: true});
        rerender({active: true});
        expect(store.getAll).toHaveBeenCalledTimes(1);
    });

    it('refreshes incrementally — reads only the changed note via get()', async () => {
        const store = makeStore({'Alpha.md': 'old body'});
        const {result, rerender} = renderHook(({notes}) => useCorpus(store, notes, true), {
            initialProps: {notes: NOTES},
        });
        await waitFor(() => expect(store.getAll).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(result.current.contentById.get('Alpha.md')).toBe('old body'));
        // Bump Alpha's updatedAt → signature changes → only the changed note is re-read via get(),
        // not the whole corpus via getAll().
        const bumped = NOTES.map((n) => (n.id === 'Alpha.md' ? {...n, updatedAt: 99} : n));
        rerender({notes: bumped});
        await waitFor(() => expect(store.get).toHaveBeenCalledWith('Alpha.md'));
        expect(store.getAll).toHaveBeenCalledTimes(1);
        expect(store.get).toHaveBeenCalledTimes(1);
    });

    it('drops the cache when the backend changes', async () => {
        const storeA = makeStore({'Alpha.md': 'a body'});
        const storeB = makeStore({'Alpha.md': 'b body'});
        const {result, rerender} = renderHook(({store}) => useCorpus(store, NOTES, true), {
            initialProps: {store: storeA},
        });
        await waitFor(() => expect(result.current.contentById.get('Alpha.md')).toBe('a body'));
        rerender({store: storeB});
        await waitFor(() => expect(result.current.contentById.get('Alpha.md')).toBe('b body'));
        expect(storeB.getAll).toHaveBeenCalledTimes(1);
    });

    it('clears loading after a getAll rejection (degrades rather than sticking loading)', async () => {
        const store = makeStore();
        store.getAll.mockRejectedValueOnce(new Error('disk gone'));
        const {result} = renderHook(() => useCorpus(store, NOTES, true));
        expect(result.current.loading).toBe(true);
        await waitFor(() => expect(result.current.loading).toBe(false));
    });
});
