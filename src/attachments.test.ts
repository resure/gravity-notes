import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {AttachmentUrlCache} from './attachments';
import type {NoteStore} from './storage/types';

/** A NoteStore stub that only implements readAttachment, counting reads. */
function fakeStore(): {store: NoteStore; reads: () => number} {
    let reads = 0;
    const store = {
        readAttachment: async (ref: string) => {
            reads += 1;
            return new Blob([ref]);
        },
    } as unknown as NoteStore;
    return {store, reads: () => reads};
}

describe('AttachmentUrlCache', () => {
    let urls: string[];
    let revoked: string[];

    beforeEach(() => {
        urls = [];
        revoked = [];
        let n = 0;
        vi.stubGlobal('URL', {
            createObjectURL: () => {
                const url = `blob:obj-${++n}`;
                urls.push(url);
                return url;
            },
            revokeObjectURL: (url: string) => revoked.push(url),
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('resolves a ref to an object URL and memoizes it (one read per ref)', async () => {
        const {store, reads} = fakeStore();
        const cache = new AttachmentUrlCache(store);

        const first = await cache.resolve('Attachments/cat.png');
        const second = await cache.resolve('Attachments/cat.png');

        expect(first).toBe(second);
        expect(reads()).toBe(1);
        expect(cache.peek('Attachments/cat.png')).toBe(first);
    });

    it('dedupes concurrent resolves of the same ref into a single read', async () => {
        const {store, reads} = fakeStore();
        const cache = new AttachmentUrlCache(store);

        const [a, b] = await Promise.all([
            cache.resolve('Attachments/cat.png'),
            cache.resolve('Attachments/cat.png'),
        ]);

        expect(a).toBe(b);
        expect(reads()).toBe(1);
    });

    it('seed creates a URL with no store read; peek returns it; resolve reuses it', async () => {
        const {store, reads} = fakeStore();
        const cache = new AttachmentUrlCache(store);

        cache.seed('Attachments/cat.png', new Blob(['x']));
        const peeked = cache.peek('Attachments/cat.png');

        expect(peeked).toBeDefined();
        expect(await cache.resolve('Attachments/cat.png')).toBe(peeked);
        expect(reads()).toBe(0);
    });

    it('forget revokes and drops a single ref (next resolve re-reads)', async () => {
        const {store, reads} = fakeStore();
        const cache = new AttachmentUrlCache(store);
        const first = await cache.resolve('Attachments/cat.png');

        cache.forget('Attachments/cat.png');

        expect(revoked).toEqual([first]);
        expect(cache.peek('Attachments/cat.png')).toBeUndefined();
        await cache.resolve('Attachments/cat.png');
        expect(reads()).toBe(2); // re-read after forget
    });

    it('dispose revokes every created URL and clears the cache', async () => {
        const {store} = fakeStore();
        const cache = new AttachmentUrlCache(store);
        const a = await cache.resolve('Attachments/a.png');
        cache.seed('Attachments/b.png', new Blob(['b']));
        const b = cache.peek('Attachments/b.png');

        cache.dispose();

        expect(revoked.sort()).toEqual([a, b].sort());
        expect(cache.peek('Attachments/a.png')).toBeUndefined();
    });

    it('does not mint a leaking URL when a read resolves after dispose()', async () => {
        // A read that completes only when we release it, so we can dispose the cache mid-flight —
        // the race that happens on a store change while an image is still loading.
        let release!: (blob: Blob) => void;
        const store = {
            readAttachment: () =>
                new Promise<Blob>((resolve) => {
                    release = resolve;
                }),
        } as unknown as NoteStore;
        const cache = new AttachmentUrlCache(store);

        const pending = cache.resolve('Attachments/late.png'); // in-flight, no URL yet
        cache.dispose(); // retire the cache while the read is still pending
        release(new Blob(['late'])); // the read settles after dispose

        await expect(pending).resolves.toBe(''); // no URL minted onto a retired cache
        expect(urls).toEqual([]); // createObjectURL was never called for the late read
    });
});
