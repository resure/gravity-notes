import type {ReactNode} from 'react';

import {Dialog, Switch} from '@gravity-ui/uikit';

import type {Settings, TextFileMode, WorkspaceSettings} from '../hooks/useSettings';

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
}: SettingsDialogProps) {
    const workspaceDescription = `Override the app settings for ${
        workspaceLabel ? `“${workspaceLabel}”` : 'this workspace'
    }. “Default” inherits it.`;
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
