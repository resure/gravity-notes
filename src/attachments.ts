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
    /**
     * Per-ref generation counter, bumped by forget(). The .then() callback captures the generation
     * at call time and bails if it no longer matches — so a read that resolves after forget() cannot
     * write a stale URL back into the cache.
     */
    private readonly generations = new Map<string, number>();
    /**
     * Listeners notified when a specific ref is forgotten — so a mounted image view can re-resolve
     * (and flip to its broken state) the instant its attachment is deleted, instead of holding a
     * dead `blob:` URL until some unrelated re-render.
     */
    private readonly listeners = new Map<string, Set<() => void>>();
    /** Set once the cache is retired, so a read resolving after dispose() can't mint a leaking URL. */
    private disposed = false;

    constructor(private readonly store: NoteStore) {}

    /**
     * Subscribe to {@link forget} of a single `ref`; returns an unsubscribe function. A live NodeView
     * uses this to react the moment its attachment is removed from the manager.
     */
    subscribe(ref: string, listener: () => void): () => void {
        let set = this.listeners.get(ref);
        if (!set) {
            set = new Set();
            this.listeners.set(ref, set);
        }
        set.add(listener);
        return () => {
            const current = this.listeners.get(ref);
            if (!current) return;
            current.delete(listener);
            if (current.size === 0) this.listeners.delete(ref);
        };
    }

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
        // Capture the current generation so the .then() can detect a forget() that fires while the
        // read is in-flight: if the generation has advanced, the URL must not be stored.
        const gen = this.generations.get(ref) ?? 0;
        const promise = this.store
            .readAttachment(ref)
            .then((blob) => {
                // Bail if the cache was retired (store change) or this ref was forgotten mid-flight.
                if (this.disposed || (this.generations.get(ref) ?? 0) !== gen) return '';
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
     * image renders instantly with no read round-trip. A no-op if `ref` is already cached (or retired),
     * or if a resolve() for the same ref is already in-flight (the inflight read would overwrite
     * the seeded URL in urls and leave the seeded one unrevoked).
     */
    seed(ref: string, blob: Blob): void {
        if (this.disposed || this.urls.has(ref) || this.pending.has(ref)) return;
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
        // Advance the generation so any in-flight resolve() for this ref bails in its .then()
        // instead of writing a stale URL back into the cache.
        this.generations.set(ref, (this.generations.get(ref) ?? 0) + 1);
        // Wake any live view of this ref so it can re-resolve (now a not-found → broken state).
        this.notify(ref);
    }

    /** Revoke every object URL this cache created (call when the cache is retired). */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const url of this.urls.values()) URL.revokeObjectURL(url);
        this.urls.clear();
        this.pending.clear();
        this.generations.clear();
        this.listeners.clear();
    }

    private notify(ref: string): void {
        const set = this.listeners.get(ref);
        if (!set) return;
        for (const listener of [...set]) listener();
    }
}

/** The active store's attachment cache; `null` outside a provider (e.g. plain unit tests). */
export const AttachmentsContext = createContext<AttachmentUrlCache | null>(null);

/** Read the active {@link AttachmentUrlCache} (may be `null` if no provider is mounted). */
export function useAttachmentCache(): AttachmentUrlCache | null {
    return useContext(AttachmentsContext);
}
