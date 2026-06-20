import {screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {renderWithProviders} from '../test/render';

import {ConflictBanner} from './ConflictBanner';

const handlers = () => ({
    onReload: vi.fn(),
    onKeepMine: vi.fn(),
    onSaveAsCopy: vi.fn(),
    onDiscard: vi.fn(),
});

describe('ConflictBanner', () => {
    it('offers reload / keep mine / save as copy when the file was modified', () => {
        renderWithProviders(<ConflictBanner deleted={false} {...handlers()} />);
        expect(screen.getByText('Changed on disk')).toBeInTheDocument();
        expect(screen.getByText('Reload')).toBeInTheDocument();
        expect(screen.getByText('Keep mine')).toBeInTheDocument();
        expect(screen.getByText('Save as copy')).toBeInTheDocument();
    });

    it('offers save as copy / discard when the file was deleted', () => {
        renderWithProviders(<ConflictBanner deleted={true} {...handlers()} />);
        expect(screen.getByText('Deleted on disk')).toBeInTheDocument();
        expect(screen.getByText('Save as copy')).toBeInTheDocument();
        expect(screen.getByText('Discard')).toBeInTheDocument();
    });
});
