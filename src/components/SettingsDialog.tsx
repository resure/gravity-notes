import type {ReactNode} from 'react';

import {Dialog, Label, Switch, Text} from '@gravity-ui/uikit';

import {useIsNarrow} from '../hooks/useIsNarrow';
import type {Settings, WorkspaceSettings} from '../hooks/useSettings';

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
    // The `row` layout spends a fixed 150px column on the label, which leaves a phone-width dialog
    // too little room for the segmented pickers — their last options ("Gray", "Unlimited") were
    // clipped off the edge. Narrow screens reuse the `stack` layout the note-appearance popover
    // already uses: label above, control across the full width.
    const rowLayout = useIsNarrow() ? 'stack' : 'row';
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
                        <AppearanceChoiceRow
                            layout={rowLayout}
                            label="Editor font"
                            options={FONT_OPTIONS}
                            value={settings.editorFont}
                            onUpdate={(value) => setSetting('editorFont', value)}
                        />
                        <AppearanceChoiceRow
                            layout={rowLayout}
                            label="Accent color"
                            options={ACCENT_OPTIONS}
                            value={settings.accentColor}
                            onUpdate={(value) => setSetting('accentColor', value)}
                        />
                        <AppearanceChoiceRow
                            layout={rowLayout}
                            label="Text width"
                            options={WIDTH_OPTIONS}
                            value={settings.textWidth}
                            onUpdate={(value) => setSetting('textWidth', value)}
                        />
                    </Section>

                    <Section title="This workspace" description={workspaceDescription}>
                        <AppearanceChoiceRow
                            layout={rowLayout}
                            label="Editor font"
                            options={FONT_OPTIONS_WS}
                            value={workspaceSettings.editorFont}
                            onUpdate={(value) => setWorkspaceSetting('editorFont', value)}
                        />
                        <AppearanceChoiceRow
                            layout={rowLayout}
                            label="Accent color"
                            options={ACCENT_OPTIONS_WS}
                            value={workspaceSettings.accentColor}
                            onUpdate={(value) => setWorkspaceSetting('accentColor', value)}
                        />
                        <AppearanceChoiceRow
                            layout={rowLayout}
                            label="Text width"
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
