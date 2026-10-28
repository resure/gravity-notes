import {useRef, useState} from 'react';

import {Dialog, TextInput} from '@gravity-ui/uikit';

import {isTauri} from '../isTauri';
import {SHORTCUTS, SHORTCUT_GROUPS, shortcutChords, shortcutMatches} from '../shortcuts';

import './ShortcutsDialog.css';

interface ShortcutsDialogProps {
    open: boolean;
    onClose: () => void;
}

/** One chord as a key cap, each key in its own slot so the cap sets the gap between them. */
function KeyCap({keys}: {keys: string[]}) {
    return (
        <kbd className="shortcuts__kbd">
            {keys.map((key, i) => (
                <span key={i}>{key}</span>
            ))}
        </kbd>
    );
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
            className="shortcuts-dialog"
            hasCloseButton={false}
            disableBodyScrollLock
        >
            <Dialog.Header caption="Keyboard shortcuts" />
            <Dialog.Body>
                <div className="shortcuts">
                    <TextInput
                        controlRef={inputRef}
                        hasClear
                        placeholder="Filter by action or keys — “link”, “cmd+k”, “⌘⇧;”"
                        controlProps={{'aria-label': 'Filter shortcuts'}}
                        value={query}
                        onUpdate={setQuery}
                    />
                    <div className="shortcuts__list">
                        {groups.length === 0 ? (
                            <p className="shortcuts__empty">No shortcut matches.</p>
                        ) : null}
                        {groups.map(({group, rows}) => (
                            <section key={group} className="shortcuts__group">
                                <h3 className="shortcuts__group-label">{group}</h3>
                                {rows.map((shortcut) => (
                                    <div key={shortcut.keys} className="shortcuts__row">
                                        <span className="shortcuts__desc">
                                            {shortcut.description}
                                        </span>
                                        <span className="shortcuts__keys">
                                            {shortcutChords(shortcut.keys).map((chord, i) => (
                                                // 'esc esc' is two identical caps; position is identity.
                                                <KeyCap key={i} keys={chord} />
                                            ))}
                                        </span>
                                    </div>
                                ))}
                            </section>
                        ))}
                    </div>
                </div>
            </Dialog.Body>
        </Dialog>
    );
}
