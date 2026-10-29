import {createRef} from 'react';

import {act, fireEvent, render} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import Editor from './Editor';
import type {EditorHandle} from './Editor';

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

function setup(value = 'Alpha\n\nBeta\n\nGamma') {
    const paneRef = createRef<HTMLDivElement>();
    const editorRef = createRef<EditorHandle>();
    const onChange = vi.fn();
    const view = render(
        <div ref={paneRef}>
            <Editor
                ref={editorRef}
                value={value}
                onChange={onChange}
                scrollContainerRef={paneRef}
            />
        </div>,
    );
    const pane = paneRef.current;
    const root = view.container.querySelector<HTMLElement>('.gn-block-editor');
    if (!pane || !root) throw new Error('Missing editor viewport');
    vi.spyOn(pane, 'getBoundingClientRect').mockImplementation(
        () => new DOMRect(80, 100, 700, 420),
    );
    vi.spyOn(root, 'getBoundingClientRect').mockImplementation(
        () => new DOMRect(80, 50 - pane.scrollTop, 700, 1000),
    );
    const blocks = [...root.querySelectorAll<HTMLElement>('.blocks > .block')];
    for (const [index, block] of blocks.entries()) {
        vi.spyOn(block, 'getBoundingClientRect').mockImplementation(
            () => new DOMRect(140, 140 + index * 60 - pane.scrollTop, 500, 30),
        );
    }
    const data = new Map<string, string>();
    const transfer = {
        files: [],
        types: ['text/plain'],
        setData: (type: string, text: string) => data.set(type, text),
        getData: (type: string) => data.get(type) ?? '',
        setDragImage: vi.fn(),
        effectAllowed: 'uninitialized',
        dropEffect: 'none',
    };
    const drag = (type: string, target: Element, y: number, x = 200) => {
        const event = new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
        });
        Object.defineProperty(event, 'dataTransfer', {value: transfer});
        fireEvent(target, event);
        return event;
    };
    const handle = (index: number) => {
        const button = blocks[index].querySelector<HTMLButtonElement>('.drag-btn');
        if (!button) throw new Error('Missing block drag handle');
        return button;
    };
    const start = (index = 0) => {
        drag('dragstart', handle(index), 150 + index * 60);
        act(() => vi.advanceTimersByTime(0));
    };
    return {pane, root, blocks, handle, drag, start, editorRef, onChange, unmount: view.unmount};
}

function contents(root: HTMLElement): string[] {
    return [...root.querySelectorAll('.blocks > .block .content')].map(
        (element) => element.textContent ?? '',
    );
}

describe('block drag across scrolling', () => {
    it('accepts a gutter gap and uses the scrolled geometry despite a stale event target', () => {
        const {pane, root, blocks, drag, start, onChange, editorRef} = setup();
        start();

        expect(drag('dragenter', blocks[0], 250, 100).defaultPrevented).toBe(true);
        const over = drag('dragover', root, 250, 100);

        expect(over.defaultPrevented).toBe(true);
        expect(blocks[2]).toHaveClass('drop-before');
        pane.scrollTop = 25;
        fireEvent.scroll(pane);
        act(() => vi.advanceTimersByTime(20));
        expect(blocks[2]).toHaveClass('drop-after');

        drag('drop', blocks[0], 250, 100);

        expect(contents(root)).toEqual(['Beta', 'Gamma', 'Alpha']);
        expect(onChange).toHaveBeenLastCalledWith('Beta\n\nGamma\n\nAlpha');
        expect(root.querySelector('.dragging, .drop-before, .drop-after')).toBeNull();
        act(() => editorRef.current?.undo());
        expect(contents(root)).toEqual(['Alpha', 'Beta', 'Gamma']);
        act(() => editorRef.current?.redo());
        expect(contents(root)).toEqual(['Beta', 'Gamma', 'Alpha']);
    });

    it('accepts the editor gap below the final block', () => {
        const {root, drag, start, onChange} = setup();
        start();

        expect(drag('dragover', root, 440).defaultPrevented).toBe(true);
        expect(drag('drop', root, 440).defaultPrevented).toBe(true);

        expect(contents(root)).toEqual(['Beta', 'Gamma', 'Alpha']);
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('does not revive a drag when a valid drop precedes the deferred styling tick', () => {
        const {root, blocks, handle, drag, onChange} = setup();
        drag('dragstart', handle(0), 150);

        drag('drop', blocks[2], 282);
        act(() => vi.runOnlyPendingTimers());

        expect(contents(root)).toEqual(['Beta', 'Gamma', 'Alpha']);
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(root.querySelector('.dragging, .drop-before, .drop-after')).toBeNull();
    });

    it('cancels immediately and rejects a drop outside the pane without reordering', () => {
        const {root, handle, drag, start, onChange} = setup();
        drag('dragstart', handle(0), 150);
        drag('dragend', handle(0), 150);
        act(() => vi.runOnlyPendingTimers());
        expect(root.querySelector('.dragging')).toBeNull();

        start();
        drag('dragover', root, 282);
        expect(drag('dragover', root, 70).defaultPrevented).toBe(false);
        drag('drop', root, 70);
        drag('dragend', handle(0), 70);
        act(() => vi.runOnlyPendingTimers());

        expect(contents(root)).toEqual(['Alpha', 'Beta', 'Gamma']);
        expect(onChange).not.toHaveBeenCalled();
        expect(root.querySelector('.dragging, .drop-before, .drop-after')).toBeNull();
    });

    it('moves a selected group with its descendants in one undo transaction', () => {
        const original = '- A\n  - A1\n- B\n- C\n- D';
        const {root, blocks, handle, drag, start, editorRef, onChange} = setup(original);
        fireEvent.click(handle(0), {metaKey: true});
        fireEvent.click(handle(2), {metaKey: true});
        start();

        drag('drop', blocks[4], 405);

        expect(contents(root)).toEqual(['C', 'D', 'A', 'A1', 'B']);
        expect(onChange).toHaveBeenLastCalledWith('- C\n- D\n- A\n  - A1\n- B');
        expect(editorRef.current?.snapshot().past).toHaveLength(1);
        act(() => editorRef.current?.undo());
        expect(contents(root)).toEqual(['A', 'A1', 'B', 'C', 'D']);
        expect(onChange).toHaveBeenLastCalledWith(original);
    });

    it('clears the deferred drag tick when the editor unmounts', () => {
        const {handle, drag, unmount} = setup();
        const before = vi.getTimerCount();
        drag('dragstart', handle(0), 150);
        expect(vi.getTimerCount()).toBeGreaterThan(before);

        unmount();

        expect(vi.getTimerCount()).toBeLessThanOrEqual(before);
    });
});
