import {useEffect} from 'react';
import type {RefObject} from 'react';

// From here on, blocks off screen skip layout and paint (`.gn-block-editor_long` in editor.css).
export const LONG_DOCUMENT_BLOCKS = 200;

const nativeAnchoring = () => typeof CSS !== 'undefined' && CSS.supports('overflow-anchor', 'auto');

// Skipped blocks take their real height only as they near the screen, which shoves the text being
// read on every block scrolled up through. Chromium's scroll anchoring absorbs that; WebKit has none.
export function useScrollAnchoring(
    rootRef: RefObject<HTMLElement | null>,
    scrollContainerRef: RefObject<HTMLElement | null> | undefined,
    enabled: boolean,
): void {
    useEffect(() => {
        const list = rootRef.current?.querySelector('.blocks');
        const container = scrollContainerRef?.current;
        if (!enabled || !list || !container || nativeAnchoring()) return undefined;

        const heights = new WeakMap<Element, number>();
        const resizes = new ResizeObserver((entries) => {
            const top = container.getBoundingClientRect().top;
            let shift = 0;
            for (const entry of entries) {
                const height = entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height;
                const before = heights.get(entry.target);
                heights.set(entry.target, height);
                if (before === undefined || before === height) continue;
                if (entry.target.getBoundingClientRect().bottom <= top) shift += height - before;
            }
            if (shift) container.scrollTop += shift;
        });
        const bodyOf = (node: Node) =>
            node instanceof Element ? node.querySelector(':scope > .block-body') : null;
        for (const block of list.children) {
            const body = bodyOf(block);
            if (body) resizes.observe(body);
        }
        const mutations = new MutationObserver((records) => {
            for (const record of records) {
                for (const node of record.addedNodes) {
                    const body = bodyOf(node);
                    if (body) resizes.observe(body);
                }
                for (const node of record.removedNodes) {
                    const body = bodyOf(node);
                    if (body) resizes.unobserve(body);
                }
            }
        });
        mutations.observe(list, {childList: true});
        return () => {
            mutations.disconnect();
            resizes.disconnect();
        };
    }, [rootRef, scrollContainerRef, enabled]);
}

export interface ScrollAnchor {
    index: number;
    offset: number;
}

function blockElements(root: HTMLElement): HTMLCollection | [] {
    return root.querySelector('.blocks')?.children ?? [];
}

export function readScrollAnchor(
    root: HTMLElement | null,
    container: HTMLElement | null | undefined,
): ScrollAnchor | null {
    if (!root || !container) return null;
    const blocks = blockElements(root);
    const top = container.getBoundingClientRect().top;
    let low = 0;
    let high = blocks.length - 1;
    let found = -1;
    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (blocks[middle].getBoundingClientRect().bottom > top) {
            found = middle;
            high = middle - 1;
        } else {
            low = middle + 1;
        }
    }
    if (found < 0) return null;
    return {index: found, offset: top - blocks[found].getBoundingClientRect().top};
}

// Not a raw `scrollTop`: after a remount the skipped blocks above are back to estimated heights.
export function restoreScrollAnchor(
    root: HTMLElement | null,
    container: HTMLElement | null | undefined,
    anchor: ScrollAnchor,
): boolean {
    if (!root || !container) return false;
    const block = blockElements(root)[anchor.index];
    if (!block || block.getClientRects().length === 0) return false;
    const delta =
        block.getBoundingClientRect().top - container.getBoundingClientRect().top + anchor.offset;
    container.scrollTop += delta;
    return true;
}
