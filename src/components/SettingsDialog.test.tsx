import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, expect, it, vi} from 'vitest';

import {useNewFileSettings, useSettings, useWorkspaceSettings} from '../hooks/useSettings';
import {renderWithProviders} from '../test/render';

import {SettingsDialog} from './SettingsDialog';

beforeEach(() => localStorage.clear());

function SettingsHarness() {
    const {settings, setSetting} = useSettings();
    const {workspaceSettings, setWorkspaceSetting} = useWorkspaceSettings('settings-test');
    const {newFileSettings, setNewFileSetting} = useNewFileSettings('settings-test');
    return (
        <SettingsDialog
            open
            onClose={vi.fn()}
            settings={settings}
            setSetting={setSetting}
            workspaceSettings={workspaceSettings}
            setWorkspaceSetting={setWorkspaceSetting}
            workspaceLabel="Test"
            newFileSettings={newFileSettings}
            setNewFileSetting={setNewFileSetting}
            folders={['Work', 'Work/Sub']}
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

it('persists the new-file folder, extension, name format and default name', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsHarness />);
    const saved = () =>
        JSON.parse(localStorage.getItem('gravity-notes:settings-test:new-files') ?? '{}');
    const select = async (label: string, option: string) => {
        await user.click(screen.getByRole('combobox', {name: label}));
        await user.click(await screen.findByRole('option', {name: option}));
        await waitFor(() => expect(screen.queryByRole('listbox', {hidden: true})).toBeNull());
    };

    expect(screen.getByRole('combobox', {name: 'New file folder'})).toHaveTextContent(
        'Current folder',
    );
    await select('New file folder', 'Workspace root');
    expect(saved().folder).toBe('');
    await select('New file folder', 'Current folder');
    expect(saved().folder).toBeNull();
    await select('New file folder', 'Work / Sub');
    expect(saved().folder).toBe('Work/Sub');
    await select('New file extension', 'Plain text (.txt)');
    expect(saved().extension).toBe('.txt');
    await select('New file extension', 'No extension');
    expect(saved().extension).toBe('');
    expect(screen.getByRole('combobox', {name: 'New file extension'})).toHaveTextContent(
        'No extension',
    );
    await select('New file name format', 'Date + name');
    expect(saved().nameFormat).toBe('date-name');
    await user.type(screen.getByRole('textbox', {name: 'New file default name'}), 'Meeting');
    expect(saved().defaultName).toBe('Meeting');
    expect(screen.getByText(/^Example:/)).toHaveTextContent(/\d{4}-\d{2}-\d{2} - Meeting/);
    expect(
        screen.getByText('A name entered in search overrides the default name and template.'),
    ).toBeVisible();
});

it('keeps an unavailable folder visible until another destination is chosen', async () => {
    localStorage.setItem('gravity-notes:settings-test:new-files', JSON.stringify({folder: 'Gone'}));
    const user = userEvent.setup();
    renderWithProviders(<SettingsHarness />);
    expect(screen.getByRole('combobox', {name: 'New file folder'})).toHaveTextContent(
        'Gone (unavailable)',
    );
    await user.click(screen.getByRole('combobox', {name: 'New file folder'}));
    await user.click(await screen.findByRole('option', {name: 'Workspace root'}));
    expect(
        JSON.parse(localStorage.getItem('gravity-notes:settings-test:new-files') ?? '{}').folder,
    ).toBe('');
});

it('disables the default name for date-only filenames without discarding it', async () => {
    localStorage.setItem(
        'gravity-notes:settings-test:new-files',
        JSON.stringify({defaultName: 'Meeting'}),
    );
    const user = userEvent.setup();
    renderWithProviders(<SettingsHarness />);
    await user.click(screen.getByRole('combobox', {name: 'New file name format'}));
    await user.click(await screen.findByRole('option', {name: 'Date'}));
    expect(screen.getByRole('textbox', {name: 'New file default name'})).toBeDisabled();
    expect(screen.getByRole('textbox', {name: 'New file default name'})).toHaveValue('Meeting');
});
