import {useRef, useState} from 'react';

import {Dialog, Hotkey, Text, TextInput} from '@gravity-ui/uikit';

import {isTauri} from '../isTauri';
import {SHORTCUTS, SHORTCUT_GROUPS, shortcutMatches} from '../shortcuts';

import './ShortcutsDialog.css';

interface ShortcutsDialogProps {
    open: boolean;
    onClose: () => void;
}

/** Read-only help sheet listing the app's keyboard shortcuts, derived from SHORTCUTS. */
export function ShortcutsDialog({open, onClose}: ShortcutsDialogProps) {
    const [query, setQuery] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const groups = SHORTCUT_GROUPS.map((group) => ({
        group,
        // Desktop-shell-only rows (per-note windows, ⌘0) are noise in the browser.
        rows: SHORTCUTS.filter(
            (shortcut) =>
                shortcut.group === group &&
                (!shortcut.desktopOnly || isTauri) &&
                shortcutMatches(shortcut, query),
        ),
    })).filter(({rows}) => rows.length > 0);

    return (
        // The app shell already locks scroll (index.css overflow:hidden), so the modal's own
        // body-scroll-lock is redundant — and toggling it on open repaints the whole page (flicker).
        <Dialog
            open={open}
            onClose={onClose}
            onTransitionOutComplete={() => setQuery('')}
            initialFocus={inputRef}
            size="s"
            disableBodyScrollLock
            contentOverflow="auto"
        >
            <Dialog.Header caption="Keyboard shortcuts" />
            <Dialog.Body>
                <div className="shortcuts-dialog">
                    <div className="shortcuts-dialog__filter">
                        <TextInput
                            controlRef={inputRef}
                            hasClear
                            placeholder="Filter by action or keys — “link”, “cmd+k”, “⌘⇧;”"
                            controlProps={{'aria-label': 'Filter shortcuts'}}
                            value={query}
                            onUpdate={setQuery}
                        />
                    </div>
                    {groups.length === 0 && <Text color="secondary">No shortcut matches.</Text>}
                    {groups.map(({group, rows}) => {
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
