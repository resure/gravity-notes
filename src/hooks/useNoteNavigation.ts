import {useCallback, useEffect, useRef, useState} from 'react';
import type {RefObject} from 'react';

export interface NoteNavigationDeps {
    /** The currently open note id (from `useNotes`), or null. */
    activeId: string | null;
    /** Load + activate a note (from `useNotes`). */
    open(id: string): Promise<void>;
    /** Close the open note (from `useNotes`). */
    close(): Promise<void>;
    editorRef: RefObject<{focus(): void} | null>;
    listRef: RefObject<{focusSelected(): void} | null>;
    searchInputRef: RefObject<{focus(): void} | null>;
}

export interface UseNoteNavigation {
    /** The list cursor: the highlighted row, which is also the previewed/open note. */
    selectedId: string | null;
    /** Focus intent for the next editor (re)mount: the body (a commit), the title (a new note), or none. */
    autofocus: 'body' | 'title' | null;
    /** Set the cursor without previewing (used after deleting the last note). */
    setSelected(id: string | null): void;
    /** Arm the title to focus + select on the next mount (used before creating a note). */
    prepareCreate(): void;
    /** Move the highlight and preview the note immediately; focus stays in the list. */
    browse(id: string): void;
    /** Open the note for editing and focus the editor. */
    commit(id: string): void;
    /** Leave the editor: return focus to the selected list row (the note stays open). */
    escapeEditor(): void;
    /** Leave the list for the search box; the open note stays open. */
    escapeToSearch(): void;
    /** From the search box: close the open note and clear the cursor. */
    closeFromSearch(): void;
}

/**
 * Coalesce window for preview-opens while browsing. A single (or slow) arrow press still previews
 * instantly — the leading edge fires `open()` immediately. A burst of presses (a held arrow flying
 * down a long list, or rapid clicks) is coalesced: the editor opens once on the leading edge and
 * once more — for the note actually landed on — when the burst settles (no browse for this long). So
 * a continuous scroll that used to remount the heavy editor ~10×/s (once per window) now does it
 * roughly twice per whole gesture; the cursor highlight still tracks every press instantly.
 */
const BROWSE_COALESCE_MS = 100;

/**
 * Keyboard-first browse/edit navigation for the single-pane note app. Owns the list
 * cursor (`selectedId`) and previews the highlighted note in the editor immediately,
 * without stealing focus. `commit` focuses the editor; the Esc ladder walks focus back
 * (editor → list → search), and a final Esc in the search box closes + deselects. Storage stays in `useNotes`;
 * this hook only sequences intent + focus.
 */
export function useNoteNavigation(deps: NoteNavigationDeps): UseNoteNavigation {
    const {activeId, editorRef, listRef, searchInputRef} = deps;
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [autofocus, setAutofocus] = useState<'body' | 'title' | null>(null);

    // Read open/close through refs so the callbacks stay stable and never call a stale closure.
    const openRef = useRef(deps.open);
    openRef.current = deps.open;
    const closeRef = useRef(deps.close);
    closeRef.current = deps.close;

    // Leading-edge + single-trailing coalescing of browse previews. The cursor highlight moves on
    // every press (setCursor), but the editor is heavy to remount, so the PREVIEW-OPEN is coalesced:
    // fire once on the leading edge of a burst (instant-preview feel for a single/slow press), then
    // once more for the note landed on when the burst settles. `armed` stays true across settles for
    // the whole burst (each press within the window re-arms the settle timer), so a press mid-burst
    // is never mistaken for a fresh leading edge — a continuous held-arrow scroll opens the editor
    // ~twice per gesture instead of ~10×/s.
    const coalesceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // The latest note browsed during the burst, opened when it settles.
    const trailingIdRef = useRef<string | null>(null);
    // True from the leading edge of a burst until its settle gap elapses with no further browse.
    const armedRef = useRef(false);
    // The id the leading edge already opened this burst, so a single/slow browse (whose `trailing`
    // is that same id) isn't opened a second time at settle.
    const lastOpenedRef = useRef<string | null>(null);

    const cancelCoalesce = useCallback(() => {
        if (coalesceTimerRef.current) {
            clearTimeout(coalesceTimerRef.current);
            coalesceTimerRef.current = null;
        }
        trailingIdRef.current = null;
        armedRef.current = false;
        lastOpenedRef.current = null;
    }, []);

    // The cursor auto-syncs to a restored open note exactly once, on startup; after any
    // deliberate change we stop, so a search-box close stays cleared instead of snapping
    // back to the still-closing note.
    const cursorTouchedRef = useRef(false);
    const setCursor = useCallback((id: string | null) => {
        cursorTouchedRef.current = true;
        setSelectedId(id);
    }, []);

    const browse = useCallback(
        (id: string) => {
            setCursor(id); // cursor highlight is always instant
            setAutofocus(null);
            trailingIdRef.current = id;
            if (!armedRef.current) {
                // Leading edge of a burst: preview immediately (the instant-preview feel for a single
                // / slow press). `armed` then stays true through the whole burst, so further presses
                // never re-fire a leading edge mid-burst.
                armedRef.current = true;
                lastOpenedRef.current = id;
                void openRef.current(id);
            }
            // (Re)start the settle gap on every browse; it only fires once browsing pauses. A
            // continuous burst keeps re-arming it, so the open below runs once at the end.
            if (coalesceTimerRef.current) clearTimeout(coalesceTimerRef.current);
            coalesceTimerRef.current = setTimeout(() => {
                coalesceTimerRef.current = null;
                armedRef.current = false;
                const next = trailingIdRef.current;
                trailingIdRef.current = null;
                // Open the note landed on — unless it's the same one the leading edge already opened
                // (a single/slow browse), which must not double-open.
                if (next !== null && next !== lastOpenedRef.current) {
                    void openRef.current(next);
                }
                lastOpenedRef.current = null;
            }, BROWSE_COALESCE_MS);
        },
        [setCursor],
    );

    const commit = useCallback(
        (id: string) => {
            cancelCoalesce(); // a commit supersedes any pending coalesced preview
            setCursor(id);
            if (id === activeId) {
                editorRef.current?.focus();
            } else {
                setAutofocus('body');
                void openRef.current(id);
            }
        },
        [activeId, editorRef, setCursor, cancelCoalesce],
    );

    /** Set the cursor without previewing, cancelling any pending coalesced open (deliberate override). */
    const setSelected = useCallback(
        (id: string | null) => {
            cancelCoalesce();
            setCursor(id);
        },
        [cancelCoalesce, setCursor],
    );

    const escapeEditor = useCallback(() => {
        listRef.current?.focusSelected();
    }, [listRef]);

    const escapeToSearch = useCallback(() => {
        searchInputRef.current?.focus();
    }, [searchInputRef]);

    // A final Esc in the search box closes the note and clears the cursor, so the next
    // arrow lands on the first row rather than the note we just left.
    const closeFromSearch = useCallback(() => {
        cancelCoalesce(); // don't let a pending preview re-open the note after it's closed
        void closeRef.current();
        setCursor(null);
    }, [setCursor, cancelCoalesce]);

    const prepareCreate = useCallback(() => setAutofocus('title'), []);

    // Sync the cursor to the restored open note once, on first load (see cursorTouchedRef).
    useEffect(() => {
        if (!cursorTouchedRef.current && selectedId === null && activeId !== null) {
            cursorTouchedRef.current = true;
            setSelectedId(activeId);
        }
    }, [activeId, selectedId]);

    // Drop any pending coalesced preview-open when the hook unmounts.
    useEffect(() => {
        return () => {
            if (coalesceTimerRef.current) clearTimeout(coalesceTimerRef.current);
        };
    }, []);

    return {
        selectedId,
        autofocus,
        setSelected,
        prepareCreate,
        browse,
        commit,
        escapeEditor,
        escapeToSearch,
        closeFromSearch,
    };
}
