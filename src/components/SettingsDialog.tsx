import type {ReactNode} from 'react';

import {Dialog, Label, SegmentedRadioGroup, Switch, Text} from '@gravity-ui/uikit';

import type {
    AccentColor,
    AccentColorPref,
    EditorFont,
    EditorFontPref,
    Settings,
    WorkspaceSettings,
} from '../hooks/useSettings';

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

/** A colored dot + label for the accent options, so the picker reads as a color picker. */
function accentContent(color: AccentColor, label: string): ReactNode {
    return (
        <span className="settings-accent">
            <span className={`settings-accent__dot settings-accent__dot_${color}`} />
            {label}
        </span>
    );
}

const FONT_OPTIONS: {value: EditorFont; content: string}[] = [
    {value: 'sans', content: 'Sans'},
    {value: 'serif', content: 'Serif'},
    {value: 'mono', content: 'Mono'},
];

const ACCENT_OPTIONS: {value: AccentColor; content: ReactNode}[] = [
    {value: 'amber', content: accentContent('amber', 'Amber')},
    {value: 'blue', content: accentContent('blue', 'Blue')},
    {value: 'gray', content: accentContent('gray', 'Gray')},
];

// The per-workspace pickers add a leading "Default" (inherit the app value) to the same options.
const FONT_OPTIONS_WS: {value: EditorFontPref; content: ReactNode}[] = [
    {value: 'default', content: 'Default'},
    ...FONT_OPTIONS,
];

const ACCENT_OPTIONS_WS: {value: AccentColorPref; content: ReactNode}[] = [
    {value: 'default', content: 'Default'},
    ...ACCENT_OPTIONS,
];

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
        <Dialog open={open} onClose={onClose} size="m" disableBodyScrollLock contentOverflow="auto">
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
                <Text variant="subheader-2">{title}</Text>
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

/** An inline settings row: a label on the left, a segmented picker on the right. */
function ChoiceRow<T extends string>({title, options, value, onUpdate}: ChoiceRowProps<T>) {
    return (
        <div className="settings-dialog__row">
            <span className="settings-dialog__label">
                <Text variant="body-1">{title}</Text>
            </span>
            <SegmentedRadioGroup
                size="s"
                options={options}
                value={value}
                onUpdate={onUpdate}
                aria-label={title}
            />
        </div>
    );
}
