import {Database, Folder} from '@gravity-ui/icons';
import {Button, Card, Icon, Text} from '@gravity-ui/uikit';

import type {NotesStorage} from '../hooks/useNotesStorage';

import './FolderGate.css';

/** How many recents the choice screen offers (the full list lives in the in-app switcher). */
const MAX_GATE_RECENTS = 5;

/**
 * Full-screen gate shown until a storage backend is chosen and ready. Renders the first-run
 * "where do your notes live" choice (a folder on your computer, or in this browser) and the
 * folder re-permission prompt, per the non-ready states of {@link NotesStorage}.
 */
export function FolderGate({storage}: {storage: NotesStorage}) {
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

    // 'choosing' (and 'loading', which shows the same choice briefly).
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
                    <Button
                        view="action"
                        size="l"
                        loading={storage.state === 'loading'}
                        disabled={storage.state === 'loading'}
                        onClick={() => void storage.pickFolder()}
                    >
                        Open a folder…
                    </Button>
                ) : null}
                {/* In-browser storage is a WEB option (a fallback where folder access is patchy);
                    the desktop app always uses a real folder. */}
                {storage.isTauri ? null : (
                    <Button
                        view={storage.supportsFolders ? 'outlined' : 'action'}
                        size="l"
                        loading={storage.state === 'loading' && !storage.supportsFolders}
                        // Disable while the remembered choice is still being restored, so a click
                        // can't discard it mid-bootstrap (the folder button already showed a
                        // spinner; this one didn't when `supportsFolders`, leaving it racily
                        // clickable).
                        disabled={storage.state === 'loading'}
                        onClick={() => void storage.useBrowserStorage()}
                    >
                        Store in this browser
                    </Button>
                )}
            </div>
            {!storage.supportsFolders ? (
                <Text variant="caption-2" color="secondary">
                    Saving to a folder needs a Chromium browser (Chrome/Edge). You can move your
                    notes to a folder later by exporting them.
                </Text>
            ) : null}
            {/* Known workspaces, so landing here (first run aside — e.g. after a failed folder
                probe) is never a dead end: any recent is one click away. Only once bootstrap has
                settled — clicking mid-'loading' would race the restore. */}
            {storage.state === 'choosing' && storage.workspaces.length > 0 ? (
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
