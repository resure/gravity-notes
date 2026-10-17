import {afterEach, describe, expect, it, vi} from 'vitest';

import {createHoverStore} from './hoverStore';
import {readScrollAnchor, restoreScrollAnchor} from './scrollAnchoring';
import {subscribeSelectionFrame} from './selectionFrame';

const nextFrame = () => new Promise((resolve) => window.requestAnimationFrame(resolve));

describe('createHoverStore', () => {
    it('notifies only the block that lost the pointer and the one that gained it', () => {
        const store = createHoverStore();
        const a = vi.fn();
        const b = vi.fn();
        const c = vi.fn();
        store.subscribe('a', a);
        store.subscribe('b', b);
        const unsubscribe = store.subscribe('c', c);
        store.set('a');
        store.set('b');
        store.set('b');
        expect([a.mock.calls.length, b.mock.calls.length, c.mock.calls.length]).toEqual([2, 1, 0]);
        expect(store.is('b')).toBe(true);
        unsubscribe();
        store.set('c');
        expect(c).not.toHaveBeenCalled();
    });
});

describe('subscribeSelectionFrame', () => {
    it('runs each subscriber once per frame however often the selection changes', async () => {
        const first = vi.fn();
        const second = vi.fn();
        const offFirst = subscribeSelectionFrame(first);
        const offSecond = subscribeSelectionFrame(second);
        for (let i = 0; i < 3; i++) document.dispatchEvent(new Event('selectionchange'));
        expect(first).not.toHaveBeenCalled();
        await nextFrame();
        expect([first.mock.calls.length, second.mock.calls.length]).toEqual([1, 1]);
        offFirst();
        document.dispatchEvent(new Event('selectionchange'));
        await nextFrame();
        expect([first.mock.calls.length, second.mock.calls.length]).toEqual([1, 2]);
        offSecond();
        document.dispatchEvent(new Event('selectionchange'));
        await nextFrame();
        expect(second).toHaveBeenCalledTimes(2);
    });
});

describe('scroll anchors', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    // Blocks 40px tall stacked from `top`, inside a container whose viewport starts at y = 100.
    function layout(top: () => number) {
        const container = document.createElement('div');
        const root = document.createElement('div');
        const list = document.createElement('div');
        list.className = 'blocks';
        for (let i = 0; i < 10; i++) {
            const block = document.createElement('div');
            block.className = 'block';
            block.getBoundingClientRect = () => {
                const y = top() + i * 40;
                return {top: y, bottom: y + 40} as DOMRect;
            };
            block.getClientRects = () => [block.getBoundingClientRect()] as unknown as DOMRectList;
            list.append(block);
        }
        root.append(list);
        container.append(root);
        document.body.append(container);
        container.getBoundingClientRect = () => ({top: 100}) as DOMRect;
        return {container, root};
    }

    it('saves the first block still on screen and puts it back at the same offset', () => {
        let top = -50;
        const {container, root} = layout(() => top);
        // Block 3 spans 70..110, so it is the first one reaching past the viewport top (100).
        const anchor = readScrollAnchor(root, container);
        expect(anchor).toEqual({index: 3, offset: 30});

        // After a remount the same block sits elsewhere; restoring moves it back by the difference.
        top = 500;
        Object.defineProperty(container, 'scrollTop', {value: 0, writable: true});
        expect(restoreScrollAnchor(root, container, anchor!)).toBe(true);
        expect(container.scrollTop).toBe(500 + 3 * 40 - 100 + 30);
    });

    it('declines to restore onto a block that is gone', () => {
        const {container, root} = layout(() => 0);
        expect(restoreScrollAnchor(root, container, {index: 42, offset: 0})).toBe(false);
    });
});
