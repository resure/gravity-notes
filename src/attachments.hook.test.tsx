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
