import {isTauri} from '../isTauri';
import {SHORTCUTS, SHORTCUT_GROUPS, shortcutChords} from '../shortcuts';
import {Dialog} from '../ui/Dialog';
import {Kbd} from '../ui/bits';

import './ShortcutsDialog.css';

interface ShortcutsDialogProps {
    open: boolean;
    onClose: () => void;
}

/** Read-only help sheet listing the app's keyboard shortcuts, derived from `SHORTCUTS` (⌘/). */
export function ShortcutsDialog({open, onClose}: ShortcutsDialogProps) {
    return (
        <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" width={460}>
            <div className="shortcuts">
                {SHORTCUT_GROUPS.map((group) => {
                    // Desktop-shell-only rows (per-note windows, ⌘0) are noise in the browser.
                    const rows = SHORTCUTS.filter(
                        (shortcut) =>
                            shortcut.group === group && (!shortcut.desktopOnly || isTauri),
                    );
                    if (rows.length === 0) return null;
                    return (
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
                    );
                })}
            </div>
        </Dialog>
    );
}
