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
    /** Close the open note and move focus to the search box. */
    escapeList(): void;
}

/**
 * Keyboard-first browse/edit navigation for the single-pane note app. Owns the list
 * cursor (`selectedId`) and previews the highlighted note in the editor immediately,
 * without stealing focus. `commit` focuses the editor; `escapeEditor` / `escapeList`
 * walk focus back down (editor → list → search + close). Storage stays in `useNotes`;
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

    const browse = useCallback((id: string) => {
        setSelectedId(id);
        setEditorAutofocus(false);
        void openRef.current(id);
    }, []);

    const commit = useCallback(
        (id: string) => {
            setSelectedId(id);
            if (id === activeId) {
                editorRef.current?.focus();
            } else {
                setEditorAutofocus(true);
                void openRef.current(id);
            }
        },
        [activeId, editorRef],
    );

    const escapeEditor = useCallback(() => {
        listRef.current?.focusSelected();
    }, [listRef]);

    const escapeList = useCallback(() => {
        void closeRef.current();
        searchInputRef.current?.focus();
    }, [searchInputRef]);

    const prepareCommit = useCallback(() => setEditorAutofocus(true), []);

    // Sync the cursor to the restored open note on first load.
    useEffect(() => {
        if (selectedId === null && activeId !== null) setSelectedId(activeId);
    }, [activeId, selectedId]);

    return {
        selectedId,
        editorAutofocus,
        setSelected: setSelectedId,
        prepareCommit,
        browse,
        commit,
        escapeEditor,
        escapeList,
    };
}
