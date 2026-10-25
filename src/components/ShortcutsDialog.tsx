import {useEffect, useRef, useState} from 'react';

import {isTauri} from '../isTauri';
import {SHORTCUTS, SHORTCUT_GROUPS, shortcutChords, shortcutMatches} from '../shortcuts';
import {Dialog} from '../ui/Dialog';
import {Input} from '../ui/Input';
import {Kbd} from '../ui/bits';

import './ShortcutsDialog.css';

interface ShortcutsDialogProps {
    open: boolean;
    onClose: () => void;
}

/** Read-only help sheet listing the app's keyboard shortcuts, derived from `SHORTCUTS` (⌘/). */
export function ShortcutsDialog({open, onClose}: ShortcutsDialogProps) {
    const [query, setQuery] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (open) setQuery('');
    }, [open]);
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
        <Dialog
            open={open}
            onClose={onClose}
            title="Keyboard shortcuts"
            width={460}
            initialFocus={inputRef}
        >
            <div className="shortcuts">
                <div className="shortcuts-dialog__filter">
                    <Input
                        ref={inputRef}
                        placeholder="Filter by action or keys — “link”, “cmd+k”, “⌘⇧;”"
                        aria-label="Filter shortcuts"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        onClear={() => setQuery('')}
                    />
                </div>
                {groups.length === 0 ? (
                    <p className="shortcuts__empty">No shortcut matches.</p>
                ) : null}
                {groups.map(({group, rows}) => (
                    <section key={group} className="shortcuts__group">
                        <h3 className="shortcuts__group-label">{group}</h3>
                        {rows.map((shortcut) => (
                            <div key={shortcut.keys} className="shortcuts__row">
                                <span className="shortcuts__desc">{shortcut.description}</span>
                                <span className="shortcuts__keys">
                                    {/* A chord's position in this fixed, static list IS its
                                        identity — 'esc esc' is two identical caps. */}
                                    {shortcutChords(shortcut.keys).map((chord, i) => (
                                        <Kbd key={i}>{chord.join('')}</Kbd>
                                    ))}
                                </span>
                            </div>
                        ))}
                    </section>
                ))}
            </div>
        </Dialog>
    );
}
