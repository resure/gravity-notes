import {Dialog, Hotkey, Text} from '@gravity-ui/uikit';

import './ShortcutsDialog.css';

interface ShortcutsDialogProps {
    open: boolean;
    onClose: () => void;
}

interface Shortcut {
    keys: string;
    description: string;
}

const GROUPS: {title: string; shortcuts: Shortcut[]}[] = [
    {
        title: 'Navigation',
        shortcuts: [
            {keys: 'mod+k', description: 'Focus search'},
            {keys: 'up', description: 'Previous note'},
            {keys: 'down', description: 'Next note'},
        ],
    },
    {
        title: 'Editing',
        shortcuts: [
            {keys: 'mod+j', description: 'New note'},
            {keys: 'mod+/', description: 'Toggle WYSIWYG / Markup'},
            {keys: 'f2', description: 'Rename selected note'},
        ],
    },
    {
        title: 'General',
        shortcuts: [{keys: '?', description: 'Show this help'}],
    },
];

/** Read-only help sheet listing the app's keyboard shortcuts. */
export function ShortcutsDialog({open, onClose}: ShortcutsDialogProps) {
    return (
        <Dialog open={open} onClose={onClose} size="s">
            <Dialog.Header caption="Keyboard shortcuts" />
            <Dialog.Body>
                <div className="shortcuts-dialog">
                    {GROUPS.map((group) => (
                        <div key={group.title} className="shortcuts-dialog__group">
                            <Text variant="subheader-1" color="secondary">
                                {group.title}
                            </Text>
                            {group.shortcuts.map((shortcut) => (
                                <div key={shortcut.keys} className="shortcuts-dialog__row">
                                    <Text>{shortcut.description}</Text>
                                    <Hotkey value={shortcut.keys} />
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            </Dialog.Body>
        </Dialog>
    );
}
