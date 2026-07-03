import type {ReactNode} from 'react';

import {Dialog, Label, SegmentedRadioGroup, Switch, Text} from '@gravity-ui/uikit';

import type {Settings, WorkspaceSettings} from '../hooks/useSettings';

import {
    ACCENT_OPTIONS,
    ACCENT_OPTIONS_WS,
    FONT_OPTIONS,
    FONT_OPTIONS_WS,
    WIDTH_OPTIONS,
    WIDTH_OPTIONS_WS,
} from './appearanceControls';

import './SettingsDialog.css';

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

/** App preferences sheet (⌘, / the menu). App-wide settings and per-workspace overrides. */
export function SettingsDialog({
    open,
    onClose,
    settings,
    setSetting,
    workspaceSettings,
    setWorkspaceSetting,
    workspaceLabel,
}: SettingsDialogProps) {
    const workspaceDescription = `Override the app appearance for ${
        workspaceLabel ? `“${workspaceLabel}”` : 'this workspace'
    }. “Default” inherits it.`;
    return (
        // Matches ShortcutsDialog: the app shell already locks scroll, so skip the modal's own lock.
        // size="m" is 720px — a touch wide for these rows; cap it via --g-dialog-width (see CSS).
        <Dialog
            open={open}
            onClose={onClose}
            size="m"
            className="settings-dialog-modal"
            disableBodyScrollLock
            contentOverflow="auto"
        >
            <Dialog.Header caption="Settings" />
            <Dialog.Body>
                <div className="settings-dialog">
                    <Section title="General">
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
                    </Section>

                    <Section title="Appearance">
                        <ChoiceRow
                            title="Editor font"
                            options={FONT_OPTIONS}
                            value={settings.editorFont}
                            onUpdate={(value) => setSetting('editorFont', value)}
                        />
                        <ChoiceRow
                            title="Accent color"
                            options={ACCENT_OPTIONS}
                            value={settings.accentColor}
                            onUpdate={(value) => setSetting('accentColor', value)}
                        />
                        <ChoiceRow
                            title="Text width"
                            options={WIDTH_OPTIONS}
                            value={settings.textWidth}
                            onUpdate={(value) => setSetting('textWidth', value)}
                        />
                    </Section>

                    <Section title="This workspace" description={workspaceDescription}>
                        <ChoiceRow
                            title="Editor font"
                            options={FONT_OPTIONS_WS}
                            value={workspaceSettings.editorFont}
                            onUpdate={(value) => setWorkspaceSetting('editorFont', value)}
                        />
                        <ChoiceRow
                            title="Accent color"
                            options={ACCENT_OPTIONS_WS}
                            value={workspaceSettings.accentColor}
                            onUpdate={(value) => setWorkspaceSetting('accentColor', value)}
                        />
                        <ChoiceRow
                            title="Text width"
                            options={WIDTH_OPTIONS_WS}
                            value={workspaceSettings.textWidth}
                            onUpdate={(value) => setWorkspaceSetting('textWidth', value)}
                        />
                    </Section>
                </div>
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
        <section className="settings-dialog__section">
            <div className="settings-dialog__section-head">
                <Text
                    variant="subheader-2"
                    color="secondary"
                    className="settings-dialog__section-title"
                >
                    {title}
                </Text>
                {description ? (
                    <Text color="secondary" variant="body-1">
                        {description}
                    </Text>
                ) : null}
            </div>
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

/** A toggle row: label on the left, the Switch on the right edge (platform convention). */
function ToggleRow({title, experimental, checked, onUpdate}: ToggleRowProps) {
    return (
        <div className="settings-dialog__row">
            <span className="settings-dialog__label">
                <Text variant="body-1">{title}</Text>
                {experimental ? (
                    <Label theme="info" size="xs">
                        Experimental
                    </Label>
                ) : null}
            </span>
            {/* The Switch is itself a <label>; its visible title lives beside it, so name it via aria. */}
            <Switch checked={checked} onUpdate={onUpdate} controlProps={{'aria-label': title}} />
        </div>
    );
}

interface ChoiceRowProps<T extends string> {
    title: string;
    options: {value: T; content: ReactNode}[];
    value: T;
    onUpdate: (value: T) => void;
}

/** A picker row: a fixed-width label column, the segmented control pulled left beside it. */
function ChoiceRow<T extends string>({title, options, value, onUpdate}: ChoiceRowProps<T>) {
    return (
        <div className="settings-dialog__row settings-dialog__row_choice">
            <span className="settings-dialog__label">
                <Text variant="body-1">{title}</Text>
            </span>
            <SegmentedRadioGroup
                className="settings-dialog__picker"
                options={options}
                value={value}
                onUpdate={onUpdate}
                aria-label={title}
            />
        </div>
    );
}
