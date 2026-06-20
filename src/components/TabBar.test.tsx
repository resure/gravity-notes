import {screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import {renderWithProviders} from '../test/render';

import {TabBar, type TabDescriptor} from './TabBar';

const TABS: TabDescriptor[] = [
    {id: 'Alpha.md', title: 'Alpha', unsaved: false, conflict: false},
    {id: 'Beta.md', title: 'Beta', unsaved: true, conflict: false},
];

function setup(overrides: Record<string, unknown> = {}) {
    const props = {
        tabs: TABS,
        activeId: 'Alpha.md',
        onActivate: vi.fn(),
        onClose: vi.fn(),
        ...overrides,
    };
    renderWithProviders(<TabBar {...(props as React.ComponentProps<typeof TabBar>)} />);
    return props;
}

describe('TabBar', () => {
    it('renders a tab per descriptor', () => {
        setup();
        expect(screen.getByRole('tab', {name: 'Alpha'})).toBeInTheDocument();
        expect(screen.getByRole('tab', {name: 'Beta'})).toBeInTheDocument();
    });

    it('marks the active tab', () => {
        setup({activeId: 'Beta.md'});
        expect(screen.getByRole('tab', {name: 'Beta'})).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tab', {name: 'Alpha'})).toHaveAttribute('aria-selected', 'false');
    });

    it('activates a tab on click', async () => {
        const user = userEvent.setup();
        const props = setup();
        await user.click(screen.getByRole('tab', {name: 'Beta'}));
        expect(props.onActivate).toHaveBeenCalledWith('Beta.md');
    });

    it('closes a tab from its close button', async () => {
        const user = userEvent.setup();
        const props = setup();
        await user.click(screen.getByRole('button', {name: 'Close Alpha'}));
        expect(props.onClose).toHaveBeenCalledWith('Alpha.md');
    });

    it('shows an unsaved indicator only on unsaved tabs', () => {
        setup(); // Alpha is saved, Beta is unsaved
        expect(screen.getAllByLabelText('Unsaved changes')).toHaveLength(1);
    });

    it('shows a conflict indicator on conflicted tabs', () => {
        setup({tabs: [{id: 'Alpha.md', title: 'Alpha', unsaved: false, conflict: true}]});
        expect(screen.getByLabelText('Changed on disk')).toBeInTheDocument();
    });
});
