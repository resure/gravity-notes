import {screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {SHORTCUTS} from '../shortcuts';
import {renderWithProviders} from '../test/render';

import {ShortcutsDialog} from './ShortcutsDialog';

describe('ShortcutsDialog', () => {
    it('renders a row for every shortcut in the descriptor (sans desktop-only, on the web)', () => {
        renderWithProviders(<ShortcutsDialog open onClose={vi.fn()} />);
        // jsdom is the web build (no Tauri shell), so desktop-shell-only rows are filtered out.
        const visible = SHORTCUTS.filter((shortcut) => !shortcut.desktopOnly);
        expect(visible.length).toBeLessThan(SHORTCUTS.length); // the filter has something to do
        // One row per descriptor; descriptions can repeat (e.g. two chords both make a New note).
        expect(document.querySelectorAll('.shortcuts__row')).toHaveLength(visible.length);
        for (const shortcut of visible) {
            expect(screen.getAllByText(shortcut.description).length).toBeGreaterThan(0);
        }
        for (const shortcut of SHORTCUTS.filter((s) => s.desktopOnly)) {
            expect(screen.queryByText(shortcut.description)).not.toBeInTheDocument();
        }
    });

    it('includes the previously-missing rows', () => {
        renderWithProviders(<ShortcutsDialog open onClose={vi.fn()} />);
        expect(
            screen.getByText('Edit the selected note (in the title → jump to the body)'),
        ).toBeInTheDocument();
        expect(screen.getByText('Editor → list, then close (or clear search)')).toBeInTheDocument();
    });

    it('renders nothing when closed', () => {
        renderWithProviders(<ShortcutsDialog open={false} onClose={vi.fn()} />);
        expect(screen.queryByText('Focus search')).not.toBeInTheDocument();
    });
});
