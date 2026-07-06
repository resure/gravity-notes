import {act, fireEvent, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

import {loadEmojis, loadIconCatalog} from '../icons';
import {renderWithProviders} from '../test/render';

import {IconPicker} from './IconPicker';

// The picker lazy-loads its emoji + icon catalogs on first open; preload them once (both memoized at
// module scope) so options render synchronously — same trick the NoteList icon-picker tests use.
beforeAll(async () => {
    await Promise.all([loadEmojis(), loadIconCatalog()]);
});

afterEach(() => {
    vi.useRealTimers();
});

/** Open a fresh self-contained picker and return the combobox (search box) once the grid is live. */
async function openPicker(props: Partial<Parameters<typeof IconPicker>[0]> = {}) {
    const result = renderWithProviders(<IconPicker onChange={vi.fn()} {...props} />);
    fireEvent.click(screen.getByRole('button', {name: 'Set note icon'}));
    const combobox = await screen.findByRole('combobox');
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));
    return {...result, combobox};
}

describe('IconPicker', () => {
    it('keeps the keyboard-highlighted option mounted, so aria-activedescendant never dangles', async () => {
        const {combobox} = await openPicker();
        // Step into the grid, then rove far past the initial virtual window (8 cols/row → row 24).
        for (let i = 0; i < 25; i++) fireEvent.keyDown(combobox, {key: 'ArrowDown'});

        const activeId = combobox.getAttribute('aria-activedescendant');
        expect(activeId).toBeTruthy();
        // Without the rangeExtractor forcing the active row to render, this element would be
        // virtualized out and getElementById would return null — a dangling aria reference.
        const target = document.getElementById(activeId ?? '');
        expect(target).not.toBeNull();
        expect(target?.getAttribute('role')).toBe('option');
        expect(target?.className).toMatch(/icon-picker__item_active/);
    });

    it('does not crash when the highlight is roved past a then-shrunken result set', async () => {
        const {combobox} = await openPicker();
        // Rove into the grid so the highlight sits on row 3 (activeIndex 24).
        for (let i = 0; i < 4; i++) fireEvent.keyDown(combobox, {key: 'ArrowDown'});
        // Narrow to a tiny (non-empty) set — the roved row now lies PAST the shrunken list. With the
        // unguarded rangeExtractor this pushed an out-of-range index into the virtualizer and crashed
        // the render (`measurements[i]` undefined → `virtualRow.key` deref).
        fireEvent.change(combobox, {target: {value: 'unicorn'}});
        await waitFor(() => {
            const opts = screen.getAllByRole('option');
            expect(opts.length).toBeGreaterThan(0);
            // One row's worth or fewer — proves the set shrank below the roved row (row 3).
            expect(opts.length).toBeLessThan(9);
        });
    });

    it('closes an open popup when it becomes disabled (entering read-only preview mode)', async () => {
        const {rerender} = await openPicker();
        expect(screen.getByRole('listbox', {name: 'Pick an icon'})).toBeInTheDocument();

        // Toggling into preview mode disables the picker while its popup is still up.
        rerender(<IconPicker onChange={vi.fn()} disabled />);
        await waitFor(() =>
            expect(screen.queryByRole('listbox', {name: 'Pick an icon'})).toBeNull(),
        );
    });

    it('debounces the search query before filtering the grid', async () => {
        const {combobox} = await openPicker();
        const before = screen.getAllByRole('option').length;
        expect(before).toBeGreaterThan(0);

        vi.useFakeTimers();
        // A query nothing matches — once applied, the grid empties.
        fireEvent.change(combobox, {target: {value: 'zzznomatchxyz'}});
        // Debounce window (100 ms) hasn't elapsed: the grid still shows the pre-query options.
        expect(screen.getAllByRole('option').length).toBe(before);

        act(() => {
            vi.advanceTimersByTime(150);
        });
        // Now the filter has run against the settled query → no matches left.
        expect(screen.queryAllByRole('option')).toHaveLength(0);
    });
});
