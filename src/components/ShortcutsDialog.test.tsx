import {screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {SHORTCUTS} from '../shortcuts';
import {renderWithProviders} from '../test/render';

import {ShortcutsDialog} from './ShortcutsDialog';

describe('ShortcutsDialog', () => {
    it('renders a row for every shortcut in the descriptor', () => {
        renderWithProviders(<ShortcutsDialog open onClose={vi.fn()} />);
        for (const shortcut of SHORTCUTS) {
            expect(screen.getByText(shortcut.description)).toBeInTheDocument();
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
