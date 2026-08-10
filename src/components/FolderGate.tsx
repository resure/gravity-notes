import {useEffect, useState} from 'react';

import type {NotesStorage} from '../hooks/useNotesStorage';
import {isIos} from '../isTauri';
import {Button} from '../ui/Button';
import {Progress} from '../ui/Progress';
import {Database, Folder} from '../ui/icons';

import './FolderGate.css';

/** How many recents the choice screen offers (the full list lives in the in-app switcher). */
const MAX_GATE_RECENTS = 5;

/**
 * Only a restore slower than this shows anything at all. The common case — the last-active
 * workspace (or a fresh ws-/note- window's shell-assigned one, which even skips the folder probe)
 * opening in well under this — paints straight from the themed background into the workspace, with
 * no intermediate flash of gate UI.
 */
const LOADER_DELAY_MS = 300;

/**
 * The gate, shown until a storage backend is chosen and ready: the first-run "where do your notes
 * live" choice and the folder re-permission prompt, per the non-ready states of
 * {@link NotesStorage}.
 *
 * §09 calls this the single exception to "an empty state fills its pane, never the window" —
 * because before a vault is picked there is genuinely nothing else to show. It is also the only
 * place in the app that gets a FILLED button. The transient 'loading' bootstrap state renders no
 * gate UI at all: flashing the welcome card at every new window was noise.
 */
export function FolderGate({storage}: {storage: NotesStorage}) {
    if (storage.state === 'loading') {
        return (
            <div className="folder-gate">
                <DelayedWait />
            </div>
        );
    }
    return (
        <div className="folder-gate">
            <div className="folder-gate__panel">
                <Content storage={storage} />
                {storage.error ? <p className="folder-gate__error">{storage.error}</p> : null}
            </div>
        </div>
    );
}

/** Nothing for the first {@link LOADER_DELAY_MS}, then a narrow indeterminate bar (§09: no spinner). */
function DelayedWait() {
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        const timer = setTimeout(() => setVisible(true), LOADER_DELAY_MS);
        return () => clearTimeout(timer);
    }, []);
    return visible ? (
        <Progress value={null} aria-label="Opening your notes…" className="folder-gate__wait" />
    ) : null;
}

function Content({storage}: {storage: NotesStorage}) {
    if (storage.state === 'needs-permission') {
        return (
            <>
                <Folder size={26} className="folder-gate__glyph" />
                <h1 className="folder-gate__title">Reopen your notes</h1>
                <p className="folder-gate__body">
                    Grant access to “{storage.storageLabel}” to continue editing your notes.
                </p>
                <div className="folder-gate__actions">
                    <Button
                        variant="filled"
                        size="l"
                        onClick={() => void storage.grantPermission()}
                    >
                        Grant access
                    </Button>
                    <Button size="l" onClick={() => void storage.reset()}>
                        Choose different storage
                    </Button>
                </div>
            </>
        );
    }

    // 'choosing' — the bootstrap 'loading' state never reaches here (FolderGate renders the
    // delayed wait for it instead), so nothing below needs a mid-restore disabled state.
    return (
        <>
            <Folder size={26} className="folder-gate__glyph" />
            <h1 className="folder-gate__title">Choose a notes folder</h1>
            <p className="folder-gate__body">
                {storage.isTauri
                    ? // The desktop app is folder-first: notes are real .md files on disk, always.
                      'Notes are plain Markdown files. Pick any folder — an iCloud Drive folder ' +
                      'syncs across your devices.'
                    : 'Notes are plain Markdown files you fully own — kept in a folder on your ' +
                      'computer, or inside this browser.'}
            </p>
            <div className="folder-gate__actions">
                {storage.supportsFolders ? (
                    <Button variant="filled" size="l" onClick={() => void storage.pickFolder()}>
                        Open Folder…
                    </Button>
                ) : null}
                {/* In-app / in-browser storage: a WEB fallback where folder access is patchy, and —
                    until iCloud folder picking lands — the working on-device option on iOS. The
                    macOS desktop app is folder-first and never offers it. */}
                {!storage.isTauri || isIos ? (
                    <Button
                        variant={storage.supportsFolders ? 'raised' : 'filled'}
                        size="l"
                        onClick={() => void storage.useBrowserStorage()}
                    >
                        {isIos ? 'Store on this device' : 'Store in this browser'}
                    </Button>
                ) : null}
            </div>
            {!storage.supportsFolders ? (
                <p className="folder-gate__note">
                    Saving to a folder needs a Chromium browser (Chrome/Edge). You can move your
                    notes to a folder later by exporting them.
                </p>
            ) : null}
            {/* Known workspaces, so landing here (first run aside — e.g. after a failed folder
                probe) is never a dead end: any recent is one click away. */}
            {storage.workspaces.length > 0 ? (
                <div className="folder-gate__recents">
                    <p className="folder-gate__recents-label">Or reopen a recent workspace</p>
                    {storage.workspaces.slice(0, MAX_GATE_RECENTS).map((ws) => (
                        <button
                            key={ws.id}
                            type="button"
                            className="folder-gate__recent"
                            onClick={() => void storage.openWorkspace(ws.id)}
                        >
                            {ws.backend === 'indexeddb' ? (
                                <Database size={15} className="folder-gate__recent-icon" />
                            ) : (
                                <Folder size={15} className="folder-gate__recent-icon" />
                            )}
                            <span className="folder-gate__recent-name">{ws.name}</span>
                        </button>
                    ))}
                </div>
            ) : null}
        </>
    );
}
