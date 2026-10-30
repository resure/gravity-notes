import {type ReactNode, useMemo} from 'react';

import {Dialog, Select, Switch, TextInput} from '@gravity-ui/uikit';

import type {Settings, TextFileMode, WorkspaceSettings} from '../hooks/useSettings';
import {type NewFileSettings, isValidNewFileFolder, resolveNewFileCreation} from '../newFiles';
import {formatCrumb, joinPath, sanitizeTitle} from '../storage/noteText';

import {
    ACCENT_OPTIONS,
    ACCENT_OPTIONS_WS,
    AppearanceChoiceRow,
    FONT_OPTIONS,
    FONT_OPTIONS_WS,
    WIDTH_OPTIONS,
    WIDTH_OPTIONS_WS,
} from './appearanceControls';

import './SettingsDialog.css';

const TEXT_FILE_OPTIONS: {value: TextFileMode; content: string}[] = [
    {value: 'text', content: 'Plain text'},
    {value: 'markdown', content: 'Markdown'},
];
const TEXT_FILE_OPTIONS_WS: {value: 'default' | TextFileMode; content: string}[] = [
    {value: 'default', content: 'Default'},
    ...TEXT_FILE_OPTIONS,
];
const EXTENSION_OPTIONS: {value: NewFileSettings['extension']; content: string}[] = [
    {value: '.md', content: 'Markdown (.md)'},
    {value: '.txt', content: 'Plain text (.txt)'},
    {value: '', content: 'No extension'},
];
const NAME_FORMAT_OPTIONS: {value: NewFileSettings['nameFormat']; content: string}[] = [
    {value: 'name', content: 'Name only'},
    {value: 'date', content: 'Date'},
    {value: 'date-name', content: 'Date + name'},
    {value: 'datetime-name', content: 'Date and time + name'},
];

interface SettingsDialogProps {
    open: boolean;
    onClose: () => void;
    settings: Settings;
    setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
    workspaceSettings: WorkspaceSettings;
    setWorkspaceSetting: <K extends keyof WorkspaceSettings>(
        key: K,
        value: WorkspaceSettings[K],
    ) => void;
    /** Human label of the active workspace, shown in the per-workspace section subtext (if known). */
    workspaceLabel: string | null;
    newFileSettings: NewFileSettings;
    setNewFileSetting: <K extends keyof NewFileSettings>(key: K, value: NewFileSettings[K]) => void;
    folders: readonly string[];
}

/**
 * App preferences sheet (⌘, / the menu): app-wide settings and per-workspace overrides. No Save
 * button — every control commits on change and the app repaints live behind the scrim.
 */
export function SettingsDialog({
    open,
    onClose,
    settings,
    setSetting,
    workspaceSettings,
    setWorkspaceSetting,
    workspaceLabel,
    newFileSettings,
    setNewFileSetting,
    folders,
}: SettingsDialogProps) {
    const workspaceDescription = `Override the app settings for ${
        workspaceLabel ? `“${workspaceLabel}”` : 'this workspace'
    }. “Default” inherits it.`;
    const folderOptions = useMemo(() => {
        const options: {value: string; content: string; disabled?: boolean}[] = [
            {value: 'current', content: 'Current folder'},
            {value: 'path:', content: 'Workspace root'},
            ...folders.filter(Boolean).map((folder) => {
                const disabled = !isValidNewFileFolder(folder);
                return {
                    value: `path:${folder}`,
                    content: `${formatCrumb(folder)}${disabled ? ' (unsupported folder name)' : ''}`,
                    disabled,
                };
            }),
        ];
        if (newFileSettings.folder && !folders.includes(newFileSettings.folder)) {
            options.push({
                value: `path:${newFileSettings.folder}`,
                content: `${formatCrumb(newFileSettings.folder)} (unavailable)`,
                disabled: !isValidNewFileFolder(newFileSettings.folder),
            });
        }
        return options;
    }, [folders, newFileSettings.folder]);
    const newFileExample = resolveNewFileCreation(newFileSettings, {});
    return (
        // Matches ShortcutsDialog: the app shell already locks scroll, so skip the modal's own lock.
        <Dialog
            open={open}
            onClose={onClose}
            className="settings-dialog"
            hasCloseButton={false}
            disableBodyScrollLock
            contentOverflow="auto"
        >
            <Dialog.Header caption="Settings" />
            <Dialog.Body>
                <Section title="Editor">
                    <ToggleRow
                        title="Show editor toolbar"
                        checked={settings.showEditorToolbar}
                        onUpdate={(value) => setSetting('showEditorToolbar', value)}
                    />
                    <ToggleRow
                        title="Show note icons"
                        experimental
                        checked={settings.showNoteIcons}
                        onUpdate={(value) => setSetting('showNoteIcons', value)}
                    />
                    <ToggleRow
                        title="Check spelling"
                        checked={settings.spellcheck}
                        onUpdate={(value) => setSetting('spellcheck', value)}
                    />
                    <AppearanceChoiceRow
                        layout="row"
                        label="Open text files as"
                        options={TEXT_FILE_OPTIONS}
                        value={settings.textFileMode}
                        onUpdate={(value) => setSetting('textFileMode', value)}
                    />
                    <p className="settings__note">
                        Applies to .txt files and files without an extension.
                    </p>
                </Section>

                <Section title="New files" description="Defaults for this workspace.">
                    <div className="settings__row settings__row_new-file">
                        <span className="settings__label">Folder</span>
                        <Select
                            className="settings__new-file-control"
                            size="s"
                            width="max"
                            aria-label="New file folder"
                            options={folderOptions}
                            value={[
                                newFileSettings.folder === null
                                    ? 'current'
                                    : `path:${newFileSettings.folder}`,
                            ]}
                            onUpdate={([value]) => {
                                const option = folderOptions.find((item) => item.value === value);
                                if (!option || option.disabled) return;
                                if (value === 'current') setNewFileSetting('folder', null);
                                else if (value?.startsWith('path:'))
                                    setNewFileSetting('folder', value.slice(5));
                            }}
                        />
                    </div>
                    <div className="settings__row settings__row_new-file">
                        <span className="settings__label">Extension</span>
                        <Select
                            className="settings__new-file-control"
                            size="s"
                            width="max"
                            aria-label="New file extension"
                            options={EXTENSION_OPTIONS}
                            value={[newFileSettings.extension]}
                            onUpdate={([value]) => {
                                const option = EXTENSION_OPTIONS.find(
                                    (item) => item.value === value,
                                );
                                if (option) setNewFileSetting('extension', option.value);
                            }}
                        />
                    </div>
                    <div className="settings__row settings__row_new-file">
                        <span className="settings__label">Filename format</span>
                        <Select
                            className="settings__new-file-control"
                            size="s"
                            width="max"
                            aria-label="New file name format"
                            options={NAME_FORMAT_OPTIONS}
                            value={[newFileSettings.nameFormat]}
                            onUpdate={([value]) => {
                                const option = NAME_FORMAT_OPTIONS.find(
                                    (item) => item.value === value,
                                );
                                if (option) setNewFileSetting('nameFormat', option.value);
                            }}
                        />
                    </div>
                    <div className="settings__row settings__row_new-file">
                        <span className="settings__label">Default name</span>
                        <TextInput
                            className="settings__new-file-control"
                            size="s"
                            value={newFileSettings.defaultName}
                            placeholder="Untitled"
                            disabled={newFileSettings.nameFormat === 'date'}
                            controlProps={{'aria-label': 'New file default name'}}
                            onUpdate={(value) => setNewFileSetting('defaultName', value)}
                        />
                    </div>
                    <p className="settings__note settings__new-file-example">
                        Example:{' '}
                        {joinPath(
                            newFileExample.parentPath,
                            sanitizeTitle(newFileExample.title) + newFileSettings.extension,
                        )}
                    </p>
                    <p className="settings__note">
                        A name entered in search overrides the default name and template.
                    </p>
                </Section>

                <Section title="Appearance">
                    <AppearanceChoiceRow
                        layout="row"
                        label="Editor font"
                        options={FONT_OPTIONS}
                        value={settings.editorFont}
                        onUpdate={(value) => setSetting('editorFont', value)}
                    />
                    <AppearanceChoiceRow
                        layout="row"
                        label="Accent color"
                        options={ACCENT_OPTIONS}
                        value={settings.accentColor}
                        onUpdate={(value) => setSetting('accentColor', value)}
                    />
                    <AppearanceChoiceRow
                        layout="row"
                        label="Text width"
                        options={WIDTH_OPTIONS}
                        value={settings.textWidth}
                        onUpdate={(value) => setSetting('textWidth', value)}
                    />
                </Section>

                <Section title="This workspace" description={workspaceDescription}>
                    <AppearanceChoiceRow
                        layout="row"
                        label="Editor font"
                        options={FONT_OPTIONS_WS}
                        value={workspaceSettings.editorFont}
                        onUpdate={(value) => setWorkspaceSetting('editorFont', value)}
                    />
                    <AppearanceChoiceRow
                        layout="row"
                        label="Accent color"
                        options={ACCENT_OPTIONS_WS}
                        value={workspaceSettings.accentColor}
                        onUpdate={(value) => setWorkspaceSetting('accentColor', value)}
                    />
                    <AppearanceChoiceRow
                        layout="row"
                        label="Text width"
                        options={WIDTH_OPTIONS_WS}
                        value={workspaceSettings.textWidth}
                        onUpdate={(value) => setWorkspaceSetting('textWidth', value)}
                    />
                    <p className="settings__note">
                        A single note can depart from these in its own ⋯ menu, where “Default”
                        inherits what is set here.
                    </p>
                    <AppearanceChoiceRow
                        layout="row"
                        label="Open text files as"
                        options={TEXT_FILE_OPTIONS_WS}
                        value={workspaceSettings.textFileMode}
                        onUpdate={(value) => setWorkspaceSetting('textFileMode', value)}
                    />
                </Section>
            </Dialog.Body>
        </Dialog>
    );
}

interface SectionProps {
    title: string;
    description?: string;
    children: ReactNode;
}

function Section({title, description, children}: SectionProps) {
    return (
        <section className="settings">
            <h3 className="settings__section-label">{title}</h3>
            {description ? <p className="settings__description">{description}</p> : null}
            {children}
        </section>
    );
}

interface ToggleRowProps {
    title: string;
    experimental?: boolean;
    checked: boolean;
    onUpdate: (value: boolean) => void;
}

function ToggleRow({title, experimental, checked, onUpdate}: ToggleRowProps) {
    return (
        <div className="settings__row">
            <span className="settings__label">
                {title}
                {experimental ? <span className="appearance-choice__tag">Experimental</span> : null}
            </span>
            {/* The Switch is itself a <label>; its visible title lives beside it, so name it via aria. */}
            <Switch checked={checked} onUpdate={onUpdate} controlProps={{'aria-label': title}} />
        </div>
    );
}
