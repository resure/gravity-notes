import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, expect, it, vi} from 'vitest';

import {useNewFileSettings, useSettings, useWorkspaceSettings} from '../hooks/useSettings';
import {renderWithProviders} from '../test/render';

import {SettingsDialog} from './SettingsDialog';

beforeEach(() => localStorage.clear());

function SettingsHarness({folders = ['Work', 'Work/Sub']}: {folders?: readonly string[]}) {
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
            folders={folders}
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

it('persists the new-file folder', async () => {
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

it('keeps a selected nested Attachments folder after reopening settings', async () => {
    const user = userEvent.setup();
    const folders = ['Work', 'Work/Attachments'];
    const {unmount} = renderWithProviders(<SettingsHarness folders={folders} />);
    await user.click(screen.getByRole('combobox', {name: 'New file folder'}));
    await user.click(await screen.findByRole('option', {name: 'Work / Attachments'}));
    await waitFor(() => expect(screen.queryByRole('listbox', {hidden: true})).toBeNull());
    expect(
        JSON.parse(localStorage.getItem('gravity-notes:settings-test:new-files') ?? '{}'),
    ).toEqual({folder: 'Work/Attachments'});

    unmount();
    renderWithProviders(<SettingsHarness folders={folders} />);
    expect(screen.getByRole('combobox', {name: 'New file folder'})).toHaveTextContent(
        'Work / Attachments',
    );
});

it.each(['Q1?', 'Work/Q1?', 'Attachments', 'attachments/Inbox', 'Work/node_modules', '.hidden'])(
    'shows the unsupported folder %j without allowing it to replace the saved destination',
    async (folder) => {
        localStorage.setItem(
            'gravity-notes:settings-test:new-files',
            JSON.stringify({folder: 'Work'}),
        );
        const user = userEvent.setup();
        renderWithProviders(<SettingsHarness folders={['Work', folder]} />);
        await user.click(screen.getByRole('combobox', {name: 'New file folder'}));
        const option = await screen.findByRole('option', {
            name: `${folder.replaceAll('/', ' / ')} (unsupported folder name)`,
        });
        expect(option).toHaveAttribute('aria-disabled', 'true');
        await user.click(option);
        expect(
            JSON.parse(localStorage.getItem('gravity-notes:settings-test:new-files') ?? '{}')
                .folder,
        ).toBe('Work');
        expect(screen.getByRole('combobox', {name: 'New file folder'})).toHaveTextContent('Work');
    },
);

it('ignores legacy naming preferences and saves only the selected folder', async () => {
    localStorage.setItem(
        'gravity-notes:settings-test:new-files',
        JSON.stringify({
            folder: 'Work',
            extension: '.txt',
            nameFormat: 'datetime-name',
            defaultName: 'Meeting',
        }),
    );
    const user = userEvent.setup();
    renderWithProviders(<SettingsHarness />);
    expect(screen.getByRole('combobox', {name: 'New file folder'})).toHaveTextContent('Work');
    expect(screen.queryByRole('combobox', {name: 'New file extension'})).toBeNull();
    expect(screen.queryByRole('combobox', {name: 'New file name format'})).toBeNull();
    expect(screen.queryByRole('textbox', {name: 'New file default name'})).toBeNull();
    expect(screen.queryByText(/^Example:/)).toBeNull();
    expect(
        screen.queryByText('A name entered in search overrides the default name and template.'),
    ).toBeNull();
    await user.click(screen.getByRole('combobox', {name: 'New file folder'}));
    await user.click(await screen.findByRole('option', {name: 'Workspace root'}));
    expect(
        JSON.parse(localStorage.getItem('gravity-notes:settings-test:new-files') ?? '{}'),
    ).toEqual({folder: ''});
});
