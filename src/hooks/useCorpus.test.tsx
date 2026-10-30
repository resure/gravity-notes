import {renderHook, waitFor} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {searchNotes} from '../search';
import type {Note, NoteMeta} from '../storage/types';

import {useCorpus} from './useCorpus';
import type {TextFileMode} from './useSettings';

const NOTES: NoteMeta[] = [
    {id: 'Alpha.md', title: 'Alpha', updatedAt: 3},
    {id: 'Beta.md', title: 'Beta', updatedAt: 2},
    {id: 'Gamma beta.md', title: 'Gamma beta', updatedAt: 1},
];

/** A corpus source (getAll + get) with spies, so we can assert how/when the corpus is read. */
function makeStore(bodies: Record<string, string> = {}) {
    const getAll = vi.fn(async (): Promise<Note[]> =>
        NOTES.map((n) => ({...n, content: bodies[n.id] ?? ''})),
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
    it.each(['literal.txt', 'money'])(
        'changes wiki-link interpretation of cached %s without reading its body again',
        async (id) => {
            const note = {id, title: id, updatedAt: 1, content: '\uFEFF[[Beta]]\r\n\r\n'};
            const notes = [note];
            const store = {
                getAll: vi.fn(async () => notes),
                get: vi.fn(async () => note),
            };
            const {result, rerender} = renderHook(
                ({mode}: {mode: TextFileMode}) => useCorpus(store, notes, true, true, null, mode),
                {initialProps: {mode: 'text' as TextFileMode}},
            );
            await waitFor(() => expect(result.current.loading).toBe(false));
            expect(result.current.linksById.get(id)).toEqual([]);
            const contentBefore = result.current.contentById;
            rerender({mode: 'markdown'});
            expect(result.current.linksById.get(id)?.map((link) => link.target)).toEqual(['Beta']);
            expect(result.current.contentById).toBe(contentBefore);
            expect(result.current.contentById.get(id)).toBe(note.content);
            rerender({mode: 'text'});
            expect(result.current.linksById.get(id)).toEqual([]);
            expect(store.getAll).toHaveBeenCalledTimes(1);
            expect(store.get).not.toHaveBeenCalled();
        },
    );

    it.each(['literal.txt', 'money'])(
        'updates Markdown wiki links for %s from incremental and just-saved bodies',
        async (id) => {
            const meta = {id, title: id, updatedAt: 1};
            const store = {
                getAll: vi.fn(async () => [{...meta, content: '[[Beta]]\r\n'}]),
                get: vi.fn(async () => ({...meta, updatedAt: 2, content: '[[Gamma]]\r\n'})),
            };
            const {result, rerender} = renderHook(
                ({notes, open}: {notes: NoteMeta[]; open: Note | null}) =>
                    useCorpus(store, notes, true, true, open, 'markdown'),
                {initialProps: {notes: [meta], open: null as Note | null}},
            );
            await waitFor(() => expect(result.current.loading).toBe(false));
            expect(result.current.linksById.get(id)?.map((link) => link.target)).toEqual(['Beta']);
            rerender({notes: [{...meta, updatedAt: 2}], open: null});
            await waitFor(() =>
                expect(result.current.linksById.get(id)?.map((link) => link.target)).toEqual([
                    'Gamma',
                ]),
            );
            const saved = {...meta, updatedAt: 3, content: '\uFEFF[[Delta]]\r\n\r\n'};
            rerender({notes: [saved], open: saved});
            await waitFor(() =>
                expect(result.current.linksById.get(id)?.map((link) => link.target)).toEqual([
                    'Delta',
                ]),
            );
            expect(result.current.contentById.get(id)).toBe(saved.content);
            expect(store.get).toHaveBeenCalledTimes(1);
            expect(store.getAll).toHaveBeenCalledTimes(1);
        },
    );

    it('applies the current mode when an earlier corpus request finishes', async () => {
        const note = {id: 'literal.txt', title: 'literal.txt', content: '[[Beta]]'};
        const notes = [note];
        let resolveRead!: (notes: Note[]) => void;
        const store = {
            getAll: vi.fn(
                () =>
                    new Promise<Note[]>((resolve) => {
                        resolveRead = resolve;
                    }),
            ),
            get: vi.fn(async () => note),
        };
        const {result, rerender} = renderHook(
            ({mode}: {mode: TextFileMode}) => useCorpus(store, notes, true, true, null, mode),
            {initialProps: {mode: 'markdown' as TextFileMode}},
        );
        await waitFor(() => expect(store.getAll).toHaveBeenCalledTimes(1));
        rerender({mode: 'text'});
        resolveRead([note]);
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.linksById.get(note.id)).toEqual([]);
        rerender({mode: 'markdown'});
        expect(result.current.linksById.get(note.id)?.map((link) => link.target)).toEqual(['Beta']);
        expect(store.getAll).toHaveBeenCalledTimes(1);
    });

    it.each(['literal.txt', 'money'])(
        'searches literal text in %s without deriving outgoing wiki links',
        async (id) => {
            const meta: NoteMeta = {id, title: id, updatedAt: 1};
            const content = '# KUBERNETES [[Beta]]\r\n\r\n';
            const refreshedContent = 'updated [[Gamma]]\r\n';
            const store = {
                getAll: vi.fn(async (): Promise<Note[]> => [{...meta, content}]),
                get: vi.fn(async (): Promise<Note> => ({
                    ...meta,
                    updatedAt: 2,
                    content: refreshedContent,
                })),
            };
            const {result, rerender} = renderHook(
                ({notes, open}: {notes: NoteMeta[]; open: Note | null}) =>
                    useCorpus(store, notes, true, true, open),
                {initialProps: {notes: [meta], open: null as Note | null}},
            );
            await waitFor(() => expect(result.current.loading).toBe(false));
            expect(result.current.contentById.get(id)).toBe(content);
            expect(result.current.linksById.get(id)).toEqual([]);
            expect(
                searchNotes(
                    [meta],
                    result.current.contentById,
                    'kubernetes beta',
                    result.current.lowerById,
                ).map((match) => match.note.id),
            ).toEqual([id]);

            rerender({notes: [{...meta, updatedAt: 2}], open: null});
            await waitFor(() => expect(result.current.contentById.get(id)).toBe(refreshedContent));
            expect(store.get).toHaveBeenCalledWith(id);
            expect(result.current.linksById.get(id)).toEqual([]);

            const saved: Note = {
                ...meta,
                updatedAt: 3,
                content: '\uFEFFsaved [[Beta]]\r\n\r\n',
            };
            rerender({notes: [{...meta, updatedAt: 3}], open: saved});
            await waitFor(() => expect(result.current.contentById.get(id)).toBe(saved.content));
            expect(result.current.lowerById.get(id)).toBe(saved.content.toLowerCase());
            expect(result.current.linksById.get(id)).toEqual([]);
            expect(store.get).toHaveBeenCalledTimes(1);
            expect(store.getAll).toHaveBeenCalledTimes(1);
        },
    );

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

    it('seeds the just-saved open note without reading it back', async () => {
        const store = makeStore({'Alpha.md': 'old body'});
        const saved: Note = {
            id: 'Alpha.md',
            title: 'Alpha',
            updatedAt: 99,
            content: 'new body\n\n',
        };
        const {result, rerender} = renderHook(
            ({notes, open}: {notes: NoteMeta[]; open: Note | null}) =>
                useCorpus(store, notes, true, false, open),
            {initialProps: {notes: NOTES, open: null as Note | null}},
        );
        await waitFor(() => expect(store.getAll).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(result.current.contentById.get('Alpha.md')).toBe('old body'));

        const bumped = NOTES.map((n) => (n.id === 'Alpha.md' ? {...n, updatedAt: 99} : n));
        rerender({notes: bumped, open: saved});
        await waitFor(() => expect(result.current.contentById.get('Alpha.md')).toBe('new body'));
        // The in-memory save is authoritative — no file was re-read for it.
        expect(store.get).not.toHaveBeenCalled();
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

    it('keeps linksById identity across a position-preserving edit (backlinks skip a rebuild)', async () => {
        // The link index is held separately so its object identity can stay stable across an edit that
        // doesn't change any [[…]] (target or position). A backlinks inversion keyed on linksById then
        // bails out instead of rebuilding the whole graph on every autosave.
        const bodies: Record<string, string> = {'Alpha.md': 'see [[Beta]] please'};
        const store = makeStore(bodies);
        const {result, rerender} = renderHook(({notes}) => useCorpus(store, notes, true), {
            initialProps: {notes: NOTES},
        });
        await waitFor(() => expect(store.getAll).toHaveBeenCalledTimes(1));
        await waitFor(() =>
            expect(result.current.contentById.get('Alpha.md')).toBe('see [[Beta]] please'),
        );
        const linksBefore = result.current.linksById;
        const contentBefore = result.current.contentById;
        expect(linksBefore.get('Alpha.md')?.map((l) => l.target)).toEqual(['Beta']);

        // Edit Alpha's body (mutating the live bodies the store reads) + bump updatedAt, keeping
        // [[Beta]] at the same offset so neither its target nor its position changes.
        bodies['Alpha.md'] = 'see [[Beta]] and more prose now';
        const bumped = NOTES.map((n) => (n.id === 'Alpha.md' ? {...n, updatedAt: 99} : n));
        rerender({notes: bumped});
        await waitFor(() => expect(store.get).toHaveBeenCalledWith('Alpha.md'));
        await waitFor(() =>
            expect(result.current.contentById.get('Alpha.md')).toContain('more prose'),
        );

        // Content changed identity (search must re-score), but the link index kept its identity.
        expect(result.current.contentById).not.toBe(contentBefore);
        expect(result.current.linksById).toBe(linksBefore);
        expect(result.current.linksById.get('Alpha.md')?.map((l) => l.target)).toEqual(['Beta']);
    });

    it('takes a new linksById identity when a note acquires a new [[…]] link', async () => {
        const bodies: Record<string, string> = {'Alpha.md': 'see [[Beta]]'};
        const store = makeStore(bodies);
        const {result, rerender} = renderHook(({notes}) => useCorpus(store, notes, true), {
            initialProps: {notes: NOTES},
        });
        await waitFor(() => expect(store.getAll).toHaveBeenCalledTimes(1));
        await waitFor(() =>
            expect(result.current.contentById.get('Alpha.md')).toBe('see [[Beta]]'),
        );
        const linksBefore = result.current.linksById;

        bodies['Alpha.md'] = 'see [[Beta]] and [[Gamma beta]]';
        const bumped = NOTES.map((n) => (n.id === 'Alpha.md' ? {...n, updatedAt: 99} : n));
        rerender({notes: bumped});
        await waitFor(() =>
            expect(result.current.linksById.get('Alpha.md')?.map((l) => l.target)).toEqual([
                'Beta',
                'Gamma beta',
            ]),
        );
        // The graph changed → a fresh links map (new identity), so consumers rebuild.
        expect(result.current.linksById).not.toBe(linksBefore);
    });
});
