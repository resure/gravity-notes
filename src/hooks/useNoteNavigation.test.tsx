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

    it('coalesces a rapid browse burst (leading-edge): previews the first, then the note it lands on', () => {
        vi.useFakeTimers();
        try {
            const deps = makeDeps();
            const {result} = renderHook(() => useNoteNavigation(deps));
            // First browse previews immediately (leading edge — instant-preview feel preserved)…
            act(() => {
                result.current.browse('A.md');
            });
            expect(deps.open).toHaveBeenCalledTimes(1);
            expect(deps.open).toHaveBeenNthCalledWith(1, 'A.md');
            // …but a burst of further browses within the window doesn't remount the editor per press;
            // the cursor still moves instantly to the latest row.
            act(() => {
                result.current.browse('B.md');
            });
            act(() => {
                result.current.browse('C.md');
            });
            expect(deps.open).toHaveBeenCalledTimes(1); // still only the leading open
            expect(result.current.selectedId).toBe('C.md');
            // When the burst settles, the note actually landed on (C) opens.
            act(() => {
                vi.advanceTimersByTime(100);
            });
            expect(deps.open).toHaveBeenCalledTimes(2);
            expect(deps.open).toHaveBeenNthCalledWith(2, 'C.md');
        } finally {
            vi.useRealTimers();
        }
    });

    it('coalesces a CONTINUOUS held-arrow burst to ~2 opens total (leading + settle)', () => {
        // The finite-burst test above can't tell a leading+trailing coalesce from a re-arm-every-window
        // one (its burst settles after one window). This covers the real symptom: a long held-arrow
        // scroll whose key-repeat cadence is far shorter than the coalesce window. The editor must
        // remount ~twice per gesture (leading + settle), not once per window (~10×/s).
        vi.useFakeTimers();
        try {
            const deps = makeDeps();
            const {result} = renderHook(() => useNoteNavigation(deps));
            act(() => {
                result.current.browse('N0.md');
            });
            // 50 presses, each 30 ms apart (< the 100 ms settle window) → one continuous burst.
            for (let i = 1; i <= 50; i++) {
                act(() => {
                    vi.advanceTimersByTime(30);
                });
                act(() => {
                    result.current.browse(`N${i}.md`);
                });
            }
            expect(result.current.selectedId).toBe('N50.md'); // cursor tracked every press
            expect(deps.open).toHaveBeenCalledTimes(1); // only the leading edge so far
            expect(deps.open).toHaveBeenNthCalledWith(1, 'N0.md');
            // The burst settles → the note landed on opens (the single trailing open).
            act(() => {
                vi.advanceTimersByTime(100);
            });
            expect(deps.open).toHaveBeenCalledTimes(2);
            expect(deps.open).toHaveBeenNthCalledWith(2, 'N50.md');
        } finally {
            vi.useRealTimers();
        }
    });

    it('a commit mid-burst cancels the pending trailing open (no stale re-open over the committed note)', () => {
        // While a held-arrow burst is mid-flight (a settle timer is pending), committing a different
        // note must cancel that timer — otherwise ~100 ms later it would re-open the last-browsed note
        // on top of the one the user just committed to. Guards the cancelCoalesce() call in `commit`.
        vi.useFakeTimers();
        try {
            const deps = makeDeps();
            const {result} = renderHook(() => useNoteNavigation(deps));
            act(() => {
                result.current.browse('N0.md'); // leading edge opens N0
            });
            act(() => {
                vi.advanceTimersByTime(30);
            });
            act(() => {
                result.current.browse('N1.md'); // within window → trailing = N1, no open yet
            });
            expect(deps.open).toHaveBeenCalledTimes(1);
            // Commit a third note mid-burst (activeId is null, so it opens rather than just focusing).
            act(() => {
                result.current.commit('N9.md');
            });
            expect(deps.open).toHaveBeenCalledTimes(2);
            expect(deps.open).toHaveBeenNthCalledWith(2, 'N9.md');
            // Let the (now-cancelled) settle window elapse: the trailing open of N1 must NOT fire.
            act(() => {
                vi.advanceTimersByTime(200);
            });
            expect(deps.open).toHaveBeenCalledTimes(2);
            expect(result.current.selectedId).toBe('N9.md');
        } finally {
            vi.useRealTimers();
        }
    });

    it('a slow (non-burst) browse previews immediately each time', () => {
        vi.useFakeTimers();
        try {
            const deps = makeDeps();
            const {result} = renderHook(() => useNoteNavigation(deps));
            act(() => {
                result.current.browse('A.md');
            });
            // Let the coalesce window lapse, so the next browse is again a fresh leading edge.
            act(() => {
                vi.advanceTimersByTime(100);
            });
            act(() => {
                result.current.browse('B.md');
            });
            expect(deps.open).toHaveBeenCalledTimes(2);
            expect(deps.open).toHaveBeenNthCalledWith(1, 'A.md');
            expect(deps.open).toHaveBeenNthCalledWith(2, 'B.md');
        } finally {
            vi.useRealTimers();
        }
    });

    it('commit on a not-yet-open note opens it with body autofocus', () => {
        const deps = makeDeps({activeId: null});
        const {result} = renderHook(() => useNoteNavigation(deps));
        act(() => {
            result.current.commit('A.md');
        });
        expect(deps.open).toHaveBeenCalledWith('A.md');
        expect(result.current.autofocus).toBe('body');
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

    it('prepareCreate arms title autofocus for the next mount', () => {
        const deps = makeDeps();
        const {result} = renderHook(() => useNoteNavigation(deps));
        expect(result.current.autofocus).toBeNull();
        act(() => {
            result.current.prepareCreate();
        });
        expect(result.current.autofocus).toBe('title');
    });

    it('browse clears autofocus (a preview must not steal focus)', () => {
        const deps = makeDeps();
        const {result} = renderHook(() => useNoteNavigation(deps));
        act(() => {
            result.current.prepareCreate();
        });
        expect(result.current.autofocus).toBe('title');
        act(() => {
            result.current.browse('A.md');
        });
        expect(result.current.autofocus).toBeNull();
    });

    it('commit on the already-open note leaves autofocus untouched', () => {
        const deps = makeDeps({activeId: 'A.md'});
        const {result} = renderHook(() => useNoteNavigation(deps));
        expect(result.current.autofocus).toBeNull();
        act(() => {
            result.current.commit('A.md');
        });
        expect(result.current.autofocus).toBeNull();
    });
});
