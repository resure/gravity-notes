export interface BlockDropTarget {
    id: string;
    edge: 'before' | 'after';
}

export function findBlockDropTarget(
    root: HTMLElement,
    x: number,
    y: number,
): BlockDropTarget | null {
    const bounds = root.getBoundingClientRect();
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null;
    const blocks = root.querySelector('.blocks')?.children;
    if (!blocks?.length) return null;

    let low = 0;
    let high = blocks.length - 1;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (blocks[middle].getBoundingClientRect().bottom < y) low = middle + 1;
        else high = middle;
    }
    const block = blocks[low];
    const rect = block.getBoundingClientRect();
    if (low > 0 && y < rect.top) {
        const previous = blocks[low - 1];
        if (y - previous.getBoundingClientRect().bottom < rect.top - y) {
            return {id: previous.id, edge: 'after'};
        }
    }
    return {id: block.id, edge: y < rect.top + rect.height / 2 ? 'before' : 'after'};
}
