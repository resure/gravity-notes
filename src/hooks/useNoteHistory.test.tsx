import {act, renderHook} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {useNoteHistory} from './useNoteHistory';

/**
 * Drive the hook the way Workspace does: `activeId` is a controlled prop (a real visit changes it),
 * and `navigate` is the side effect we assert on. `live` is a mutable set so a test can "delete" a
 * note mid-trail. Stepping back/forward in the app changes activeId too, so tests rerender with the
 * navigated id to mirror that.
 */
function setup(initialActive: string | null, ids: string[]) {
    const live = new Set(ids);
    const navigate = vi.fn();
    const {result, rerender} = renderHook(
        ({activeId}: {activeId: string | null}) =>
            useNoteHistory({activeId, exists: (id) => live.has(id), navigate}),
        {initialProps: {activeId: initialActive}},
    );
    const visit = (id: string | null) => act(() => rerender({activeId: id}));
    return {result, navigate, live, visit};
}

describe('useNoteHistory', () => {
    it('records visits and steps back then forward through them', () => {
        const {result, navigate, visit} = setup('A.md', ['A.md', 'B.md', 'C.md']);
        visit('B.md');
        visit('C.md');
        expect(result.current.canGoBack).toBe(true);
        expect(result.current.canGoForward).toBe(false);

        act(() => result.current.goBack());
        expect(navigate).toHaveBeenLastCalledWith('B.md');
        visit('B.md'); // the app's activeId follows the navigation
        expect(result.current.canGoForward).toBe(true);

        act(() => result.current.goForward());
        expect(navigate).toHaveBeenLastCalledWith('C.md');
        visit('C.md');
        expect(result.current.canGoForward).toBe(false);
    });

    it('drops the forward tail when a new note is visited from the middle', () => {
        const {result, navigate, visit} = setup('A.md', ['A.md', 'B.md', 'C.md', 'D.md']);
        visit('B.md');
        visit('C.md');
        act(() => result.current.goBack()); // → B
        visit('B.md');

        visit('D.md'); // a brand-new visit from the middle
        expect(result.current.canGoForward).toBe(false); // C is gone
        act(() => result.current.goBack());
        expect(navigate).toHaveBeenLastCalledWith('B.md');
    });

    it('skips a deleted note when stepping back', () => {
        const {result, navigate, live, visit} = setup('A.md', ['A.md', 'B.md', 'C.md']);
        visit('B.md');
        visit('C.md');
        live.delete('B.md'); // B is removed from the workspace

        act(() => result.current.goBack()); // from C, skip the gone B, land on A
        expect(navigate).toHaveBeenLastCalledWith('A.md');
    });

    it('does not record a re-open of the current note, and a close keeps the trail', () => {
        const {result, navigate, visit} = setup('A.md', ['A.md', 'B.md']);
        visit('B.md');
        visit('B.md'); // re-selecting the open note must not add a duplicate entry
        visit(null); // closing the note leaves the trail and its cursor intact

        act(() => result.current.goBack());
        expect(navigate).toHaveBeenLastCalledWith('A.md');
        expect(navigate).toHaveBeenCalledTimes(1); // only the one deliberate step
    });

    it('exposes canGoBack/canGoForward starting from a single entry', () => {
        const {result} = setup('A.md', ['A.md']);
        expect(result.current.canGoBack).toBe(false);
        expect(result.current.canGoForward).toBe(false);
    });
});
