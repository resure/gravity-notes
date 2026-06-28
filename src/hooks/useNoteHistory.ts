import {useCallback, useEffect, useRef, useState} from 'react';

export interface NoteHistoryDeps {
    /** The currently open note id (from `useNotes`), or null. Drives visit recording. */
    activeId: string | null;
    /** Whether an id still refers to a live note — deleted/renamed-away ones are skipped on traversal. */
    exists(id: string): boolean;
    /** Open + reveal a note (wired in Workspace to commit it, like clicking it open). */
    navigate(id: string): void;
}

export interface UseNoteHistory {
    /** Step back to the previously-visited (still-existing) note. No-op at the start of the trail. */
    goBack(): void;
    /** Step forward again after going back. No-op at the most-recent entry. */
    goForward(): void;
    /** Whether there's an older entry to step back to (for optional affordances). */
    canGoBack: boolean;
    /** Whether there's a newer entry to step forward to. */
    canGoForward: boolean;
}

/** Cap the trail so a long session can't grow it without bound. */
const MAX_ENTRIES = 100;

/**
 * Browser-style back/forward across visited notes. Every note that becomes active — from any source
 * (clicking, ⌘J/⌘K, search, a wiki link, a restored note) — is appended to a single trail, with the
 * current entry deduped so stepping back/forward never re-records itself (the activeId change a step
 * produces lands back on the same entry). Visiting a new note from the middle of the trail drops the
 * forward tail, exactly like a browser.
 *
 * Deleted (or renamed-away) ids are simply skipped when traversing, so the trail self-heals without
 * tracking id remaps. State lives in refs so `goBack`/`goForward` stay stable across renders; a small
 * mirror exposes the can-go flags. Storage stays in `useNotes`; this only sequences intent.
 */
export function useNoteHistory({activeId, exists, navigate}: NoteHistoryDeps): UseNoteHistory {
    const entriesRef = useRef<string[]>([]);
    const indexRef = useRef(-1);
    // Read deps through refs so the step callbacks never close over a stale function.
    const existsRef = useRef(exists);
    existsRef.current = exists;
    const navigateRef = useRef(navigate);
    navigateRef.current = navigate;

    const [flags, setFlags] = useState({canGoBack: false, canGoForward: false});

    // The nearest still-existing entry from the cursor in a direction, or -1 (skipping dead ids).
    const seek = useCallback((dir: 1 | -1): number => {
        const entries = entriesRef.current;
        for (let k = indexRef.current + dir; k >= 0 && k < entries.length; k += dir) {
            if (existsRef.current(entries[k])) return k;
        }
        return -1;
    }, []);

    const syncFlags = useCallback(() => {
        const canGoBack = seek(-1) !== -1;
        const canGoForward = seek(1) !== -1;
        setFlags((prev) =>
            prev.canGoBack === canGoBack && prev.canGoForward === canGoForward
                ? prev
                : {canGoBack, canGoForward},
        );
    }, [seek]);

    // Record each newly-active note. Re-opening the current note, and the activeId change a back/
    // forward step itself produces, both land on entries[index] and are deduped here.
    useEffect(() => {
        if (activeId === null) return; // closing a note leaves the trail (and its cursor) intact
        const entries = entriesRef.current;
        const i = indexRef.current;
        if (i >= 0 && entries[i] === activeId) {
            syncFlags();
            return;
        }
        // A genuine new visit: drop any forward tail, append, and cap from the front.
        const next = entries.slice(0, i + 1);
        next.push(activeId);
        if (next.length > MAX_ENTRIES) next.splice(0, next.length - MAX_ENTRIES);
        entriesRef.current = next;
        indexRef.current = next.length - 1;
        syncFlags();
    }, [activeId, syncFlags]);

    const step = useCallback(
        (dir: 1 | -1) => {
            const target = seek(dir);
            if (target === -1) return;
            // Move the cursor before navigating so the resulting activeId change dedupes (above).
            indexRef.current = target;
            syncFlags();
            navigateRef.current(entriesRef.current[target]);
        },
        [seek, syncFlags],
    );

    const goBack = useCallback(() => step(-1), [step]);
    const goForward = useCallback(() => step(1), [step]);

    return {goBack, goForward, canGoBack: flags.canGoBack, canGoForward: flags.canGoForward};
}
