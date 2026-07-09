import {useEffect, useState} from 'react';

import {Database, Folder} from '@gravity-ui/icons';
import {Button, Card, Icon, Loader, Text} from '@gravity-ui/uikit';

import type {NotesStorage} from '../hooks/useNotesStorage';
import {isIos} from '../isTauri';

import './FolderGate.css';

/** How many recents the choice screen offers (the full list lives in the in-app switcher). */
const MAX_GATE_RECENTS = 5;

/**
 * Only a restore slower than this shows the bootstrap spinner at all. The common case — the
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
 * window was noise — just a spinner once the restore proves slow (see LOADER_DELAY_MS).
 */
export function FolderGate({storage}: {storage: NotesStorage}) {
    if (storage.state === 'loading') {
        return (
            <div className="folder-gate">
                <DelayedLoader />
            </div>
        );
    }
    return (
        <div className="folder-gate">
            <Card className="folder-gate__card" view="raised">
                <Content storage={storage} />
                {storage.error ? (
                    <Text color="danger" className="folder-gate__error">
                        {storage.error}
                    </Text>
                ) : null}
            </Card>
        </div>
    );
}

/** Nothing for the first {@link LOADER_DELAY_MS}, then a plain centered spinner. */
function DelayedLoader() {
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        const timer = setTimeout(() => setVisible(true), LOADER_DELAY_MS);
        return () => clearTimeout(timer);
    }, []);
    return visible ? <Loader size="m" /> : null;
}

function Content({storage}: {storage: NotesStorage}) {
    if (storage.state === 'needs-permission') {
        return (
            <>
                <Icon data={Folder} size={32} className="folder-gate__icon" />
                <Text variant="header-1">Reopen your notes</Text>
                <Text color="secondary">
                    Grant access to “{storage.storageLabel}” to continue editing your notes.
                </Text>
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
    // delayed spinner for it instead), so nothing below needs a mid-restore disabled state.
    return (
        <>
            <Icon data={Folder} size={32} className="folder-gate__icon" />
            <Text variant="header-1">Welcome to Gravity Notes</Text>
            <Text color="secondary">
                {storage.isTauri
                    ? // The desktop app is folder-first: notes are real .md files on disk, always.
                      'Choose your notes folder. Each note is a plain Markdown file you fully own.'
                    : 'Choose where to keep your notes. Each note is a plain Markdown file you ' +
                      'fully own — stored in a folder on your computer, or inside this browser.'}
            </Text>
            <div className="folder-gate__actions">
                {storage.supportsFolders ? (
                    <Button view="action" size="l" onClick={() => void storage.pickFolder()}>
                        Open a folder…
                    </Button>
                ) : null}
                {/* In-app / in-browser storage: a WEB fallback where folder access is patchy, and —
                    until iCloud folder picking lands — the working on-device option on iOS. The
                    macOS desktop app is folder-first and never offers it. */}
                {!storage.isTauri || isIos ? (
                    <Button
                        view={storage.supportsFolders ? 'outlined' : 'action'}
                        size="l"
                        onClick={() => void storage.useBrowserStorage()}
                    >
                        {isIos ? 'Store on this device' : 'Store in this browser'}
                    </Button>
                ) : null}
            </div>
            {!storage.supportsFolders ? (
                <Text variant="caption-2" color="secondary">
                    Saving to a folder needs a Chromium browser (Chrome/Edge). You can move your
                    notes to a folder later by exporting them.
                </Text>
            ) : null}
            {/* Known workspaces, so landing here (first run aside — e.g. after a failed folder
                probe) is never a dead end: any recent is one click away. */}
            {storage.workspaces.length > 0 ? (
                <div className="folder-gate__recents">
                    <Text variant="caption-2" color="secondary">
                        Or reopen a recent workspace:
                    </Text>
                    {storage.workspaces.slice(0, MAX_GATE_RECENTS).map((ws) => (
                        <Button
                            key={ws.id}
                            view="flat"
                            size="m"
                            width="max"
                            onClick={() => void storage.openWorkspace(ws.id)}
                        >
                            <Icon data={ws.backend === 'indexeddb' ? Database : Folder} size={14} />
                            {ws.name}
                        </Button>
                    ))}
                </div>
            ) : null}
        </>
    );
}
