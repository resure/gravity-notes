import {screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {renderWithProviders} from '../test/render';

import {ShortcutsDialog} from './ShortcutsDialog';

describe('ShortcutsDialog', () => {
    it('lists the documented shortcuts when open', () => {
        renderWithProviders(<ShortcutsDialog open onClose={vi.fn()} />);
        expect(screen.getByText('Focus search')).toBeInTheDocument();
        expect(screen.getByText('New note')).toBeInTheDocument();
        expect(screen.getByText('Toggle WYSIWYG / Markup')).toBeInTheDocument();
        expect(screen.getByText('Show this help')).toBeInTheDocument();
    });

    it('renders nothing when closed', () => {
        renderWithProviders(<ShortcutsDialog open={false} onClose={vi.fn()} />);
        expect(screen.queryByText('Focus search')).not.toBeInTheDocument();
    });
});
