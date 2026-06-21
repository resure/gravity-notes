import {screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import {renderWithProviders} from '../test/render';

import {ThemeSwitcher} from './ThemeSwitcher';

describe('ThemeSwitcher', () => {
    it('calls onChange with the chosen preference', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderWithProviders(<ThemeSwitcher pref="system" onChange={onChange} />);
        await user.click(screen.getByRole('button', {name: 'Theme'}));
        await user.click(await screen.findByRole('menuitem', {name: 'Dark'}));
        expect(onChange).toHaveBeenCalledWith('dark');
    });
});
