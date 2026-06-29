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
 * Default LRU byte budget for resolved object URLs. Browsing image-heavy notes accumulates decoded
 * `blob:` URLs (the bytes stay alive until revoked); without a cap a long session over a large media
 * vault grows unbounded. 256 MB comfortably holds the open note's images plus a generous working set,
 * so eviction only fires in genuinely heavy sessions — and never touches an on-screen image (see
 * {@link AttachmentUrlCache.evictToCap}).
 */
const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;

/** One cached object URL plus the byte size of the blob behind it (for the LRU budget). */
interface CachedUrl {
    url: string;
    size: number;
}

/**
 * Resolves `Attachments/<name>` references to `blob:` object URLs for one `NoteStore`, memoizing by
 * ref so each attachment's bytes are read and `createObjectURL`'d at most once. The `urls` map is kept
 * in access order (most-recently-used last) and bounded to a byte budget: resolving past the budget
 * revokes the least-recently-used URLs first, skipping any ref a live view is still showing (a
 * subscriber). Everything is revoked in bulk via {@link dispose} (called when the active store changes),
 * since object URLs otherwise leak until the page unloads.
 */
export class AttachmentUrlCache {
    private readonly urls = new Map<string, CachedUrl>();
    private readonly pending = new Map<string, Promise<string>>();
    /** Running sum of the byte sizes of every blob behind a cached URL (the LRU budget is on this). */
    private bytes = 0;
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

    constructor(
        private readonly store: NoteStore,
        private readonly maxBytes: number = DEFAULT_MAX_BYTES,
    ) {}

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
        const entry = this.urls.get(ref);
        if (!entry) return undefined;
        this.touch(ref); // about to be displayed → keep it off the LRU eviction front
        return entry.url;
    }

    /** Read `ref`'s bytes (once) and return a cached object URL for display. */
    resolve(ref: string): Promise<string> {
        const existing = this.urls.get(ref);
        if (existing) {
            this.touch(ref);
            return Promise.resolve(existing.url);
        }
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
                this.cacheUrl(ref, url, blob.size);
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
        this.cacheUrl(ref, URL.createObjectURL(blob), blob.size);
    }

    /** Revoke and drop a single ref's object URL — call after deleting that attachment. */
    forget(ref: string): void {
        const entry = this.urls.get(ref);
        if (entry) {
            URL.revokeObjectURL(entry.url);
            this.urls.delete(ref);
            this.bytes -= entry.size;
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
        for (const entry of this.urls.values()) URL.revokeObjectURL(entry.url);
        this.urls.clear();
        this.bytes = 0;
        this.pending.clear();
        this.generations.clear();
        this.listeners.clear();
    }

    private notify(ref: string): void {
        const set = this.listeners.get(ref);
        if (!set) return;
        for (const listener of [...set]) listener();
    }

    /** Move `ref` to the most-recently-used end of the LRU order (a no-op if it isn't cached). */
    private touch(ref: string): void {
        const entry = this.urls.get(ref);
        if (entry) {
            this.urls.delete(ref);
            this.urls.set(ref, entry);
        }
    }

    /** Record a freshly-minted URL, then evict LRU entries if that pushed us over the byte budget. */
    private cacheUrl(ref: string, url: string, size: number): void {
        this.urls.set(ref, {url, size});
        this.bytes += size;
        this.evictToCap(ref);
    }

    /**
     * Revoke least-recently-used object URLs until back under the byte budget. Skips `keepRef` (the one
     * just added) and any ref with a live subscriber — a mounted image view (the open note's NodeViews)
     * subscribes, so its URL is never revoked out from under a visible <img>. Map iteration order is
     * insertion/access order, so this walks oldest-first.
     */
    private evictToCap(keepRef?: string): void {
        if (this.bytes <= this.maxBytes) return;
        for (const [ref, entry] of this.urls) {
            if (this.bytes <= this.maxBytes) break;
            if (ref === keepRef || this.listeners.has(ref)) continue;
            URL.revokeObjectURL(entry.url);
            this.urls.delete(ref);
            this.bytes -= entry.size;
        }
    }
}

/** The active store's attachment cache; `null` outside a provider (e.g. plain unit tests). */
export const AttachmentsContext = createContext<AttachmentUrlCache | null>(null);

/** Read the active {@link AttachmentUrlCache} (may be `null` if no provider is mounted). */
export function useAttachmentCache(): AttachmentUrlCache | null {
    return useContext(AttachmentsContext);
}
