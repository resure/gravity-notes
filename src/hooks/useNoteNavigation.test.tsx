import {act, renderHook} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

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
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('browse updates the cursor instantly and previews after the debounce', () => {
        const deps = makeDeps();
        const {result} = renderHook(() => useNoteNavigation(deps));
        act(() => {
            result.current.browse('A.md');
        });
        expect(result.current.selectedId).toBe('A.md');
        expect(deps.open).not.toHaveBeenCalled();
        act(() => {
            vi.advanceTimersByTime(150);
        });
        expect(deps.open).toHaveBeenCalledWith('A.md');
    });

    it('rapid browse only previews the note settled on', () => {
        const deps = makeDeps();
        const {result} = renderHook(() => useNoteNavigation(deps));
        act(() => {
            result.current.browse('A.md');
        });
        act(() => {
            vi.advanceTimersByTime(100);
        });
        act(() => {
            result.current.browse('B.md');
        });
        act(() => {
            vi.advanceTimersByTime(150);
        });
        expect(deps.open).toHaveBeenCalledTimes(1);
        expect(deps.open).toHaveBeenCalledWith('B.md');
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

    it('escapeList closes the note and focuses the search box', () => {
        const focus = vi.fn();
        const deps = makeDeps({searchInputRef: {current: {focus}}});
        const {result} = renderHook(() => useNoteNavigation(deps));
        act(() => {
            result.current.escapeList();
        });
        expect(deps.close).toHaveBeenCalledTimes(1);
        expect(focus).toHaveBeenCalledTimes(1);
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

    it('unmount clears a pending preview timer (no leak / late open)', () => {
        const deps = makeDeps();
        const {result, unmount} = renderHook(() => useNoteNavigation(deps));
        act(() => {
            result.current.browse('A.md');
        });
        unmount();
        act(() => {
            vi.advanceTimersByTime(200);
        });
        expect(deps.open).not.toHaveBeenCalled();
    });
});
