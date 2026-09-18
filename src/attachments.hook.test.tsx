import {useEffect} from 'react';

import {act, render, waitFor} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {AttachmentUrlCache, useAttachmentUrl} from './attachments';
import type {NoteStore} from './storage/types';

function storeWith(refs: Record<string, boolean>): NoteStore {
    return {
        readAttachment: async (ref: string) => {
            if (!refs[ref]) throw new Error('gone');
            return new Blob([ref]);
        },
    } as unknown as NoteStore;
}

describe('useAttachmentUrl — the resolver every display surface shares', () => {
    it('reports the broken state when an attachment is forgotten, not a permanent spinner', async () => {
        vi.stubGlobal('URL', {
            ...URL,
            createObjectURL: () => 'blob:x',
            revokeObjectURL: () => {},
        });
        const present: Record<string, boolean> = {'Attachments/a.png': true};
        const cache = new AttachmentUrlCache(storeWith(present));
        const seen: Array<{url?: string; failed: boolean}> = [];

        function Probe() {
            seen.push(useAttachmentUrl('Attachments/a.png', cache));
            return null;
        }
        render(<Probe />);
        await waitFor(() => expect(seen[seen.length - 1].url).toBe('blob:x'));

        // `notify` fires only from `forget()`, which has already revoked and dropped the entry — so
        // a listener that merely re-`peek`s sees undefined and renders "still loading" for good.
        // That is what both display surfaces did, in two different ways.
        // The manager deletes the file and THEN forgets the ref, which is the order that matters:
        // the re-load finds nothing, and that is what has to surface as broken.
        await act(async () => {
            delete present['Attachments/a.png'];
            cache.forget('Attachments/a.png');
        });
        await waitFor(() => {
            expect(seen[seen.length - 1].failed).toBe(true);
            expect(seen[seen.length - 1].url).toBeUndefined();
        });
        vi.unstubAllGlobals();
    });

    it('never shows the previous ref’s image while the new one is resolving', async () => {
        let nextUrl = 0;
        vi.stubGlobal('URL', {
            ...URL,
            createObjectURL: () => `blob:${++nextUrl}`,
            revokeObjectURL: () => {},
        });
        // Only the first file exists: the second resolves to the broken state, which is the case
        // that made a stale URL stick around forever rather than for one frame.
        const cache = new AttachmentUrlCache(storeWith({'Attachments/a.png': true}));
        const seen: Array<{refPath: string; url?: string; failed: boolean}> = [];

        // Recorded in an EFFECT, not in the render body: the fix re-seeds state DURING render, so
        // React throws that pass away and re-runs it. A render-body probe would see the discarded
        // pass — which never reaches the screen — and report a stale URL that no user can observe.
        function Probe({refPath}: {refPath: string}) {
            const state = useAttachmentUrl(refPath, cache);
            useEffect(() => {
                seen.push({refPath, ...state});
            });
            return null;
        }
        const {rerender} = render(<Probe refPath="Attachments/a.png" />);
        await waitFor(() => expect(seen[seen.length - 1].url).toBe('blob:1'));

        // The hook outlives the ref — a virtualized row is reused for the next file.
        await act(async () => {
            rerender(<Probe refPath="Attachments/b.png" />);
        });
        // Not one render of b.png's row may carry a.png's URL: that is b.png's row, labelled
        // b.png, showing a.png.
        const asB = seen.filter((s) => s.refPath === 'Attachments/b.png');
        expect(asB.length).toBeGreaterThan(0);
        expect(asB.every((s) => s.url !== 'blob:1')).toBe(true);
        expect(seen[seen.length - 1]).toEqual({
            refPath: 'Attachments/b.png',
            url: undefined,
            failed: true,
        });
        vi.unstubAllGlobals();
    });

    it('passes an absolute URL straight through, without the cache', () => {
        const seen: Array<{url?: string; failed: boolean}> = [];
        function Probe() {
            seen.push(useAttachmentUrl('https://example.com/a.png', null));
            return null;
        }
        render(<Probe />);
        expect(seen[seen.length - 1]).toEqual({url: 'https://example.com/a.png', failed: false});
    });
});
