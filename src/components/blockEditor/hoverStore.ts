// Which block the pointer is over, outside React state: a long note's blocks subscribe by id, so a
// crossing re-renders the two blocks it concerns rather than the whole editor.
export interface HoverStore {
    is(id: string): boolean;
    set(id: string | null): void;
    subscribe(id: string, listener: () => void): () => void;
}

export function createHoverStore(): HoverStore {
    let current: string | null = null;
    const listeners = new Map<string, Set<() => void>>();
    const notify = (id: string | null) => {
        if (id) listeners.get(id)?.forEach((listener) => listener());
    };
    return {
        is: (id) => current === id,
        set(id) {
            if (id === current) return;
            const previous = current;
            current = id;
            notify(previous);
            notify(id);
        },
        subscribe(id, listener) {
            let own = listeners.get(id);
            if (!own) listeners.set(id, (own = new Set()));
            own.add(listener);
            return () => {
                own.delete(listener);
                if (own.size === 0) listeners.delete(id);
            };
        },
    };
}
