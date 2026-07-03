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

/** A colored dot + label for the accent-color options, so the picker reads as a color picker. */
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
const FONT_OPTIONS_WS: {value: EditorFontPref; content: string}[] = [
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
    const workspaceDescription = `Override the appearance for ${
        workspaceLabel ? `“${workspaceLabel}”` : 'this workspace'
    } only. “Default” follows the app setting above.`;
    return (
        // Matches ShortcutsDialog: the app shell already locks scroll, so skip the modal's own lock.
        <Dialog open={open} onClose={onClose} size="s" disableBodyScrollLock contentOverflow="auto">
            <Dialog.Header caption="Settings" />
            <Dialog.Body>
                <div className="settings-dialog">
                    <Section title="General">
                        <SettingRow
                            title="Show editor toolbar"
                            description="Show the formatting toolbar above the note editor."
                            checked={settings.showEditorToolbar}
                            onUpdate={(value) => setSetting('showEditorToolbar', value)}
                        />
                        <SettingRow
                            title="Show note icons"
                            experimental
                            description="Show a custom icon for each note in the list and its title."
                            checked={settings.showNoteIcons}
                            onUpdate={(value) => setSetting('showNoteIcons', value)}
                        />
                        <ChoiceRow
                            title="Editor font"
                            description="Font for the editor and preview — not the app or raw Markdown."
                            options={FONT_OPTIONS}
                            value={settings.editorFont}
                            onUpdate={(value) => setSetting('editorFont', value)}
                        />
                        <ChoiceRow
                            title="Accent color"
                            description="The app's highlight color (menu orb, save dot, selection)."
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
        <div className="settings-dialog__section">
            <div className="settings-dialog__section-head">
                <Text variant="subheader-2">{title}</Text>
                {description ? (
                    <Text color="secondary" variant="body-1">
                        {description}
                    </Text>
                ) : null}
            </div>
            {children}
        </div>
    );
}

interface SettingRowProps {
    title: string;
    description: string;
    experimental?: boolean;
    checked: boolean;
    onUpdate: (value: boolean) => void;
}

function SettingRow({title, description, experimental, checked, onUpdate}: SettingRowProps) {
    return (
        <div className="settings-dialog__row">
            <div className="settings-dialog__text">
                <div className="settings-dialog__title">
                    <Text variant="subheader-1">{title}</Text>
                    {experimental ? (
                        <Label theme="info" size="xs">
                            Experimental
                        </Label>
                    ) : null}
                </div>
                <Text color="secondary" variant="body-1">
                    {description}
                </Text>
            </div>
            {/* The Switch is itself a <label>; its visible title lives beside it, so name it via aria. */}
            <Switch checked={checked} onUpdate={onUpdate} controlProps={{'aria-label': title}} />
        </div>
    );
}

interface ChoiceRowProps<T extends string> {
    title: string;
    description?: string;
    options: {value: T; content: ReactNode}[];
    value: T;
    onUpdate: (value: T) => void;
}

/** A stacked settings row: title/description above a full-width segmented picker. */
function ChoiceRow<T extends string>({
    title,
    description,
    options,
    value,
    onUpdate,
}: ChoiceRowProps<T>) {
    return (
        <div className="settings-dialog__row settings-dialog__row_stacked">
            <div className="settings-dialog__text">
                <Text variant="subheader-1">{title}</Text>
                {description ? (
                    <Text color="secondary" variant="body-1">
                        {description}
                    </Text>
                ) : null}
            </div>
            <SegmentedRadioGroup
                size="s"
                width="max"
                options={options}
                value={value}
                onUpdate={onUpdate}
                aria-label={title}
            />
        </div>
    );
}
