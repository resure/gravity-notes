import {renderHook} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {useHeldValue} from './useHeldValue';

describe('useHeldValue', () => {
    it('returns the live value while it is set', () => {
        const {result, rerender} = renderHook(({v}) => useHeldValue(v), {
            initialProps: {v: 'a' as string | null},
        });
        expect(result.current).toBe('a');
        rerender({v: 'b'});
        expect(result.current).toBe('b');
    });

    it('holds the last non-null value after it clears (the close-animation case)', () => {
        const {result, rerender} = renderHook(({v}) => useHeldValue(v), {
            initialProps: {v: 'open' as string | null},
        });
        expect(result.current).toBe('open');
        rerender({v: null}); // parent cleared state on confirm/cancel; dialog still fading out
        expect(result.current).toBe('open');
    });

    it('is null until the first non-null value', () => {
        const {result, rerender} = renderHook(({v}) => useHeldValue(v), {
            initialProps: {v: null as string | null},
        });
        expect(result.current).toBeNull();
        rerender({v: 'x'});
        expect(result.current).toBe('x');
        rerender({v: null});
        expect(result.current).toBe('x'); // now holds
    });

    it('treats 0 / empty-string as real values to hold (nullish, not falsy)', () => {
        const {result, rerender} = renderHook(({v}) => useHeldValue(v), {
            initialProps: {v: 0 as number | null},
        });
        expect(result.current).toBe(0);
        rerender({v: null});
        expect(result.current).toBe(0);
    });
});
