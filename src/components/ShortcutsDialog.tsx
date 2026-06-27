import {Dialog, Hotkey, Text} from '@gravity-ui/uikit';

import {SHORTCUTS, SHORTCUT_GROUPS} from '../shortcuts';

import './ShortcutsDialog.css';

interface ShortcutsDialogProps {
    open: boolean;
    onClose: () => void;
}

/** Read-only help sheet listing the app's keyboard shortcuts, derived from SHORTCUTS. */
export function ShortcutsDialog({open, onClose}: ShortcutsDialogProps) {
    return (
        // The app shell already locks scroll (index.css overflow:hidden), so the modal's own
        // body-scroll-lock is redundant — and toggling it on open repaints the whole page (flicker).
        <Dialog open={open} onClose={onClose} size="s" disableBodyScrollLock>
            <Dialog.Header caption="Keyboard shortcuts" />
            <Dialog.Body>
                <div className="shortcuts-dialog">
                    {SHORTCUT_GROUPS.map((group) => {
                        const rows = SHORTCUTS.filter((shortcut) => shortcut.group === group);
                        if (rows.length === 0) return null;
                        return (
                            <div key={group} className="shortcuts-dialog__group">
                                <Text variant="subheader-1" color="secondary">
                                    {group}
                                </Text>
                                {rows.map((shortcut) => (
                                    <div key={shortcut.keys} className="shortcuts-dialog__row">
                                        <Text>{shortcut.description}</Text>
                                        <Hotkey value={shortcut.keys} />
                                    </div>
                                ))}
                            </div>
                        );
                    })}
                </div>
            </Dialog.Body>
        </Dialog>
    );
}
