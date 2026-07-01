import {Dialog, Label, Switch, Text} from '@gravity-ui/uikit';

import type {Settings} from '../hooks/useSettings';

import './SettingsDialog.css';

interface SettingsDialogProps {
    open: boolean;
    onClose: () => void;
    settings: Settings;
    setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

/** App preferences sheet (⌘, / the menu). Each row toggles one {@link Settings} flag. */
export function SettingsDialog({open, onClose, settings, setSetting}: SettingsDialogProps) {
    return (
        // Matches ShortcutsDialog: the app shell already locks scroll, so skip the modal's own lock.
        <Dialog open={open} onClose={onClose} size="s" disableBodyScrollLock contentOverflow="auto">
            <Dialog.Header caption="Settings" />
            <Dialog.Body>
                <div className="settings-dialog">
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
                </div>
            </Dialog.Body>
        </Dialog>
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
                        <Label theme="warning" size="xs">
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
