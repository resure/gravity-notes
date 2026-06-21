import {act, renderHook} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {type NoteNavigationDeps, useNoteNavigation} from './useNoteNavigation';

function makeDeps(over: Partial<NoteNavigationDeps> = {}): NoteNavigationDeps {
    return {
        activeId: null,
        open: vi.fn(async () => {}),
        close: vi.fn(async () => {}),
        editorRef: {current: {focus: vi.fn()}},
        listRef: {current: {focusSelected: vi.fn()}},
        searchInputRef: {current: {focus: vi.fn()}},
        ...over,
    };
}

describe('useNoteNavigation', () => {
    it('browse updates the cursor and previews the note immediately', () => {
        const deps = makeDeps();
        const {result} = renderHook(() => useNoteNavigation(deps));
        act(() => {
            result.current.browse('A.md');
        });
        expect(result.current.selectedId).toBe('A.md');
        expect(deps.open).toHaveBeenCalledWith('A.md');
    });

    it('rapid browse previews each note immediately (no debounce)', () => {
        const deps = makeDeps();
        const {result} = renderHook(() => useNoteNavigation(deps));
        act(() => {
            result.current.browse('A.md');
        });
        act(() => {
            result.current.browse('B.md');
        });
        expect(deps.open).toHaveBeenCalledTimes(2);
        expect(deps.open).toHaveBeenNthCalledWith(1, 'A.md');
        expect(deps.open).toHaveBeenNthCalledWith(2, 'B.md');
        expect(result.current.selectedId).toBe('B.md');
    });

    it('commit on a not-yet-open note opens it with autofocus', () => {
        const deps = makeDeps({activeId: null});
        const {result} = renderHook(() => useNoteNavigation(deps));
        act(() => {
            result.current.commit('A.md');
        });
        expect(deps.open).toHaveBeenCalledWith('A.md');
        expect(result.current.editorAutofocus).toBe(true);
    });

    it('commit on the already-open note focuses the editor without reopening', () => {
        const focus = vi.fn();
        const deps = makeDeps({activeId: 'A.md', editorRef: {current: {focus}}});
        const {result} = renderHook(() => useNoteNavigation(deps));
        act(() => {
            result.current.commit('A.md');
        });
        expect(deps.open).not.toHaveBeenCalled();
        expect(focus).toHaveBeenCalledTimes(1);
    });

    it('escapeEditor focuses the selected list row', () => {
        const focusSelected = vi.fn();
        const deps = makeDeps({listRef: {current: {focusSelected}}});
        const {result} = renderHook(() => useNoteNavigation(deps));
        act(() => {
            result.current.escapeEditor();
        });
        expect(focusSelected).toHaveBeenCalledTimes(1);
    });

    it('escapeToSearch focuses the search box and keeps the note open', () => {
        const focus = vi.fn();
        const deps = makeDeps({searchInputRef: {current: {focus}}});
        const {result} = renderHook(() => useNoteNavigation(deps));
        act(() => {
            result.current.escapeToSearch();
        });
        expect(focus).toHaveBeenCalledTimes(1);
        expect(deps.close).not.toHaveBeenCalled();
    });

    it('closeFromSearch closes the note and clears the cursor (no re-sync)', () => {
        const deps = makeDeps({activeId: 'A.md'});
        const {result} = renderHook(() => useNoteNavigation(deps));
        // The cursor syncs to the restored note on mount...
        expect(result.current.selectedId).toBe('A.md');
        act(() => {
            result.current.closeFromSearch();
        });
        // ...and a search-box close clears it (not re-synced from the lingering activeId).
        expect(deps.close).toHaveBeenCalledTimes(1);
        expect(result.current.selectedId).toBeNull();
    });

    it('syncs the cursor to the restored open note', () => {
        const {result, rerender} = renderHook(
            (props: {activeId: string | null}) =>
                useNoteNavigation(makeDeps({activeId: props.activeId})),
            {initialProps: {activeId: null as string | null}},
        );
        expect(result.current.selectedId).toBeNull();
        rerender({activeId: 'A.md'});
        expect(result.current.selectedId).toBe('A.md');
    });

    it('prepareCommit arms editor autofocus for the next mount', () => {
        const deps = makeDeps();
        const {result} = renderHook(() => useNoteNavigation(deps));
        expect(result.current.editorAutofocus).toBe(false);
        act(() => {
            result.current.prepareCommit();
        });
        expect(result.current.editorAutofocus).toBe(true);
    });

    it('browse resets editorAutofocus (a preview must not steal focus)', () => {
        const deps = makeDeps();
        const {result} = renderHook(() => useNoteNavigation(deps));
        act(() => {
            result.current.prepareCommit();
        });
        expect(result.current.editorAutofocus).toBe(true);
        act(() => {
            result.current.browse('A.md');
        });
        expect(result.current.editorAutofocus).toBe(false);
    });

    it('commit on the already-open note leaves editorAutofocus untouched', () => {
        const deps = makeDeps({activeId: 'A.md'});
        const {result} = renderHook(() => useNoteNavigation(deps));
        expect(result.current.editorAutofocus).toBe(false);
        act(() => {
            result.current.commit('A.md');
        });
        expect(result.current.editorAutofocus).toBe(false);
    });
});
