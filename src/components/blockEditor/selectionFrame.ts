const subscribers = new Set<() => void>();
let frame = 0;

function flush() {
    frame = 0;
    for (const subscriber of [...subscribers]) subscriber();
}

function schedule() {
    if (!frame) frame = window.requestAnimationFrame(flush);
}

// `selectionchange` can fire several times a frame (key repeat, a drag-select), and every overlay
// that follows the caret listens to it; one shared listener runs them all once per frame instead.
export function subscribeSelectionFrame(subscriber: () => void): () => void {
    if (subscribers.size === 0) document.addEventListener('selectionchange', schedule);
    subscribers.add(subscriber);
    return () => {
        subscribers.delete(subscriber);
        if (subscribers.size > 0) return;
        document.removeEventListener('selectionchange', schedule);
        if (frame) window.cancelAnimationFrame(frame);
        frame = 0;
    };
}
