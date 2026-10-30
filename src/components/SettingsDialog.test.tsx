import {screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, expect, it, vi} from 'vitest';

import {useSettings, useWorkspaceSettings} from '../hooks/useSettings';
import {renderWithProviders} from '../test/render';

import {SettingsDialog} from './SettingsDialog';

beforeEach(() => localStorage.clear());

function SettingsHarness() {
    const {settings, setSetting} = useSettings();
    const {workspaceSettings, setWorkspaceSetting} = useWorkspaceSettings('settings-test');
    return (
        <SettingsDialog
            open
            onClose={vi.fn()}
            settings={settings}
            setSetting={setSetting}
            workspaceSettings={workspaceSettings}
            setWorkspaceSetting={setWorkspaceSetting}
            workspaceLabel="Test"
        />
    );
}

it('lets app and workspace select how text files open', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsHarness />);
    const [app, workspace] = await screen.findAllByRole('radiogroup', {
        name: 'Open text files as',
    });
    expect(within(app).getByRole('radio', {name: 'Plain text'})).toBeChecked();
    expect(within(workspace).getByRole('radio', {name: 'Default'})).toBeChecked();
    await user.click(within(app).getByRole('radio', {name: 'Markdown'}));
    expect(JSON.parse(localStorage.getItem('gravity-notes:settings') ?? '{}').textFileMode).toBe(
        'markdown',
    );
    await user.click(within(workspace).getByRole('radio', {name: 'Plain text'}));
    expect(
        JSON.parse(localStorage.getItem('gravity-notes:settings-test:settings') ?? '{}')
            .textFileMode,
    ).toBe('text');
});
