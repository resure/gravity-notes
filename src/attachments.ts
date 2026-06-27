/**
 * Display-time bridge between a note's stable attachment references (`Attachments/foo.png`, what
 * lives in the Markdown) and a loadable browser URL (a `blob:` object URL), without ever mutating the
 * stored Markdown. The custom image NodeView (WYSIWYG) and `NotePreview` (read-only) both resolve a
 * ref through one shared, per-store `AttachmentUrlCache`, so the bytes are read once and the object
 * URL is reused everywhere — then revoked together when the store changes.
 */
import {createContext, useContext} from 'react';

import type {NoteStore} from './storage/types';

/**
 * Resolves `Attachments/<name>` references to `blob:` object URLs for one `NoteStore`, memoizing by
 * ref so each attachment's bytes are read and `createObjectURL`'d at most once. URLs are revoked in
 * bulk via {@link dispose} (called when the active store changes), since object URLs leak until then.
 */
export class AttachmentUrlCache {
    private readonly urls = new Map<string, string>();
    private readonly pending = new Map<string, Promise<string>>();

    constructor(private readonly store: NoteStore) {}

    /** Synchronously return an already-resolved object URL for `ref`, or `undefined` if not yet read. */
    peek(ref: string): string | undefined {
        return this.urls.get(ref);
    }

    /** Read `ref`'s bytes (once) and return a cached object URL for display. */
    resolve(ref: string): Promise<string> {
        const existing = this.urls.get(ref);
        if (existing) return Promise.resolve(existing);
        const inflight = this.pending.get(ref);
        if (inflight) return inflight;
        const promise = this.store
            .readAttachment(ref)
            .then((blob) => {
                const url = URL.createObjectURL(blob);
                this.urls.set(ref, url);
                this.pending.delete(ref);
                return url;
            })
            .catch((err) => {
                this.pending.delete(ref);
                throw err;
            });
        this.pending.set(ref, promise);
        return promise;
    }

    /**
     * Pre-populate the cache with an object URL straight from an in-memory upload, so a just-dropped
     * image renders instantly with no read round-trip. A no-op if `ref` is already cached.
     */
    seed(ref: string, blob: Blob): void {
        if (this.urls.has(ref)) return;
        this.urls.set(ref, URL.createObjectURL(blob));
    }

    /** Revoke and drop a single ref's object URL — call after deleting that attachment. */
    forget(ref: string): void {
        const url = this.urls.get(ref);
        if (url) {
            URL.revokeObjectURL(url);
            this.urls.delete(ref);
        }
        this.pending.delete(ref);
    }

    /** Revoke every object URL this cache created (call when the cache is retired). */
    dispose(): void {
        for (const url of this.urls.values()) URL.revokeObjectURL(url);
        this.urls.clear();
        this.pending.clear();
    }
}

/** The active store's attachment cache; `null` outside a provider (e.g. plain unit tests). */
export const AttachmentsContext = createContext<AttachmentUrlCache | null>(null);

/** Read the active {@link AttachmentUrlCache} (may be `null` if no provider is mounted). */
export function useAttachmentCache(): AttachmentUrlCache | null {
    return useContext(AttachmentsContext);
}
