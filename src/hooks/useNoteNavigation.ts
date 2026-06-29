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
 * instantly — the leading edge fires `open()` immediately. Only presses arriving *within* this window
 * (a held arrow key flying down a long list) are coalesced, so the heavy editor isn't remounted (and
 * the note re-read from disk) once per keystroke; the note you land on opens when the burst settles.
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

    // Leading-edge coalescing of browse previews. `coalesceTimer` non-null = inside a burst window;
    // `trailingId` is the latest note browsed during the window, opened when it ends.
    const coalesceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const trailingIdRef = useRef<string | null>(null);
    // Re-armable via a ref so `browse` needn't depend on its identity (it's reset each render).
    const armWindowRef = useRef<() => void>(() => {});
    armWindowRef.current = () => {
        coalesceTimerRef.current = setTimeout(() => {
            coalesceTimerRef.current = null;
            const next = trailingIdRef.current;
            if (next !== null) {
                // The burst settled (or continues): open the most-recent note and re-arm, so a long
                // continuous scroll opens roughly once per window instead of once per keystroke.
                trailingIdRef.current = null;
                void openRef.current(next);
                armWindowRef.current();
            }
        }, BROWSE_COALESCE_MS);
    };
    const cancelCoalesce = useCallback(() => {
        if (coalesceTimerRef.current) {
            clearTimeout(coalesceTimerRef.current);
            coalesceTimerRef.current = null;
        }
        trailingIdRef.current = null;
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
            if (coalesceTimerRef.current === null) {
                // Leading edge: a single / slow browse previews immediately (the instant-preview feel).
                void openRef.current(id);
                armWindowRef.current();
            } else {
                // Inside a burst (held-key scroll): remember the latest; it opens when the window ends.
                trailingIdRef.current = id;
            }
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
