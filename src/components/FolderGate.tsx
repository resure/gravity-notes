import {useEffect, useState} from 'react';

import {Button, Progress} from '@gravity-ui/uikit';

import type {NotesStorage} from '../hooks/useNotesStorage';
import {Database, Folder} from '../icons/icons';
import {isIos} from '../isTauri';

import './FolderGate.css';

/** How many recents the choice screen offers (the full list lives in the in-app switcher). */
const MAX_GATE_RECENTS = 5;

/**
 * Only a restore slower than this shows the bootstrap wait at all. The common case — the
 * last-active workspace (or a fresh ws-/note- window's shell-assigned one, which even skips the
 * folder probe) opening in well under this — paints straight from the themed background into the
 * workspace, with no intermediate flash of gate UI.
 */
const LOADER_DELAY_MS = 300;

/**
 * Full-screen gate shown until a storage backend is chosen and ready. Renders the first-run
 * "where do your notes live" choice (a folder on your computer, or in this browser) and the
 * folder re-permission prompt, per the non-ready states of {@link NotesStorage}. The transient
 * 'loading' bootstrap state renders NO gate UI — flashing the welcome/choice card at every new
 * window was noise — just a short bar once the restore proves slow (see LOADER_DELAY_MS).
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

/** Nothing for the first {@link LOADER_DELAY_MS}, then a narrow indeterminate bar. */
function DelayedWait() {
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        const timer = setTimeout(() => setVisible(true), LOADER_DELAY_MS);
        return () => clearTimeout(timer);
    }, []);
    return visible ? <Progress className="folder-gate__wait" size="xs" value={100} /> : null;
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
                    <Button view="action" size="l" onClick={() => void storage.grantPermission()}>
                        Grant access
                    </Button>
                    <Button view="flat" size="l" onClick={() => void storage.reset()}>
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
                    <Button view="action" size="l" onClick={() => void storage.pickFolder()}>
                        Open Folder…
                    </Button>
                ) : null}
                {/* In-app / in-browser storage: a WEB fallback where folder access is patchy, and —
                    until iCloud folder picking lands — the working on-device option on iOS. The
                    macOS desktop app is folder-first and never offers it. */}
                {!storage.isTauri || isIos ? (
                    <Button
                        view={storage.supportsFolders ? 'raised' : 'action'}
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
