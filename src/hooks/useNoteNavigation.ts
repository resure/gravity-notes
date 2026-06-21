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
    /** Whether the next editor (re)mount should grab focus (true after a commit). */
    editorAutofocus: boolean;
    /** Set the cursor without previewing (used after deleting the last note). */
    setSelected(id: string | null): void;
    /** Arm the editor to focus on its next mount (used before creating a note). */
    prepareCommit(): void;
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
 * Keyboard-first browse/edit navigation for the single-pane note app. Owns the list
 * cursor (`selectedId`) and previews the highlighted note in the editor immediately,
 * without stealing focus. `commit` focuses the editor; the Esc ladder walks focus back
 * (editor → list → search), and a final Esc in the search box closes + deselects. Storage stays in `useNotes`;
 * this hook only sequences intent + focus.
 */
export function useNoteNavigation(deps: NoteNavigationDeps): UseNoteNavigation {
    const {activeId, editorRef, listRef, searchInputRef} = deps;
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [editorAutofocus, setEditorAutofocus] = useState(false);

    // Read open/close through refs so the callbacks stay stable and never call a stale closure.
    const openRef = useRef(deps.open);
    openRef.current = deps.open;
    const closeRef = useRef(deps.close);
    closeRef.current = deps.close;

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
            setCursor(id);
            setEditorAutofocus(false);
            void openRef.current(id);
        },
        [setCursor],
    );

    const commit = useCallback(
        (id: string) => {
            setCursor(id);
            if (id === activeId) {
                editorRef.current?.focus();
            } else {
                setEditorAutofocus(true);
                void openRef.current(id);
            }
        },
        [activeId, editorRef, setCursor],
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
        void closeRef.current();
        setCursor(null);
    }, [setCursor]);

    const prepareCommit = useCallback(() => setEditorAutofocus(true), []);

    // Sync the cursor to the restored open note once, on first load (see cursorTouchedRef).
    useEffect(() => {
        if (!cursorTouchedRef.current && selectedId === null && activeId !== null) {
            cursorTouchedRef.current = true;
            setSelectedId(activeId);
        }
    }, [activeId, selectedId]);

    return {
        selectedId,
        editorAutofocus,
        setSelected: setCursor,
        prepareCommit,
        browse,
        commit,
        escapeEditor,
        escapeToSearch,
        closeFromSearch,
    };
}
