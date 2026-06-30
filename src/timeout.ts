/**
 * Promise deadline helper (no I/O, no React — sibling to search.ts/tree.ts). Shared by the autosave
 * write-ceiling (useNotes) and the startup folder probe (useNotesStorage).
 */

/** Rejection raised by {@link withTimeout} when the deadline elapses — distinguishable via `instanceof`. */
export class TimeoutError extends Error {
    constructor(label: string, ms: number) {
        super(`${label} timed out after ${ms}ms`);
        this.name = 'TimeoutError';
    }
}

/**
 * Race `promise` against a `ms` deadline. The underlying promise still settles in the background (it
 * can't be cancelled) — this just stops the caller from awaiting it forever; on timeout it rejects
 * with a {@link TimeoutError} so the caller can tell a deadline from a real failure and move on.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (err) => {
                clearTimeout(timer);
                reject(err);
            },
        );
    });
}
