import {useRef} from 'react';

/**
 * Hold the last non-null `value` so a component can keep rendering it after the live value clears.
 *
 * The motivating case is a Gravity `<Dialog>`: its children stay mounted for the ~150ms close
 * animation, but the parent typically nulls the state driving their content the instant you
 * confirm/cancel — so the body or header would blank mid-animation. Reading from this hook keeps the
 * last value on screen through the fade-out instead.
 *
 * Returns `value` while it's set, otherwise the last non-null value (null until the first one). The
 * retained value is **display-only** — read live state for the actual action (the dialog's `open`
 * prop and its confirm/cancel handlers), so closing still does the right thing. The ref write happens
 * in render but is idempotent (it only ever advances to the latest non-null value), so it's safe
 * under StrictMode/concurrent re-renders.
 */
export function useHeldValue<T>(value: T | null): T | null {
    const ref = useRef(value);
    if (value !== null) ref.current = value;
    return value ?? ref.current;
}
