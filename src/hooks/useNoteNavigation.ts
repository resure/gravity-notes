import {useCallback, useEffect, useRef, useState} from 'react';
import type {RefObject} from 'react';

/** The list cursor previews after this idle delay, so holding an arrow stays smooth. */
const PREVIEW_DELAY = 150;

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
    /** The list cursor (drives the row highlight); updates instantly, leads `activeId` during the preview debounce. */
    selectedId: string | null;
    /** Whether the next editor (re)mount should grab focus (true after a commit). */
    editorAutofocus: boolean;
    /** Set the cursor without previewing (used after deleting the last note). */
    setSelected(id: string | null): void;
    /** Arm the editor to focus on its next mount (used before creating a note). */
    prepareCommit(): void;
    /** Move the highlight and (debounced) preview the note; focus stays in the list. */
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
 * cursor (`selectedId`, instant) and a debounced preview that loads the highlighted note
 * into the editor without stealing focus. `commit` focuses the editor; `escapeEditor` /
 * `escapeList` walk focus back down (editor → list → search + close). Storage stays in
 * `useNotes`; this hook only sequences intent + focus.
 */
export function useNoteNavigation(deps: NoteNavigationDeps): UseNoteNavigation {
    const {activeId, editorRef, listRef, searchInputRef} = deps;
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [editorAutofocus, setEditorAutofocus] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Read open/close through refs so the callbacks stay stable and never call a stale closure.
    const openRef = useRef(deps.open);
    openRef.current = deps.open;
    const closeRef = useRef(deps.close);
    closeRef.current = deps.close;

    const cancelPreview = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const browse = useCallback(
        (id: string) => {
            setSelectedId(id);
            setEditorAutofocus(false);
            cancelPreview();
            timerRef.current = setTimeout(() => {
                timerRef.current = null;
                void openRef.current(id);
            }, PREVIEW_DELAY);
        },
        [cancelPreview],
    );

    const commit = useCallback(
        (id: string) => {
            cancelPreview();
            setSelectedId(id);
            if (id === activeId) {
                editorRef.current?.focus();
            } else {
                setEditorAutofocus(true);
                void openRef.current(id);
            }
        },
        [activeId, cancelPreview, editorRef],
    );

    const escapeEditor = useCallback(() => {
        listRef.current?.focusSelected();
    }, [listRef]);

    const escapeList = useCallback(() => {
        cancelPreview();
        void closeRef.current();
        searchInputRef.current?.focus();
    }, [cancelPreview, searchInputRef]);

    const prepareCommit = useCallback(() => setEditorAutofocus(true), []);

    // Sync the cursor to the restored open note on first load.
    useEffect(() => {
        if (selectedId === null && activeId !== null) setSelectedId(activeId);
    }, [activeId, selectedId]);

    // Clear a pending preview timer on unmount.
    useEffect(() => cancelPreview, [cancelPreview]);

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
