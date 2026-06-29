import {useEffect, useState} from 'react';

/**
 * Returns `value`, delayed by `delayMs` after each change so rapid updates coalesce into one. A
 * `delayMs <= 0` is pass-through — the live `value` is returned with no timer and no one-tick lag — so
 * a caller can disable the debounce (e.g. below a size threshold) without conditionally calling the
 * hook (which the rules of hooks forbid).
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        if (delayMs <= 0) {
            // Keep the state in sync (for if debouncing turns back on) but don't gate on a timer.
            setDebounced(value);
            return undefined;
        }
        const timer = setTimeout(() => setDebounced(value), delayMs);
        return () => clearTimeout(timer);
    }, [value, delayMs]);
    // Off → return the live value (no lag); on → return the trailing debounced value.
    return delayMs <= 0 ? value : debounced;
}
