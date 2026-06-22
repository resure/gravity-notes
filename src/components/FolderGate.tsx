import {Folder} from '@gravity-ui/icons';
import {Button, Card, Icon, Text} from '@gravity-ui/uikit';

import type {NotesStorage} from '../hooks/useNotesStorage';

import './FolderGate.css';

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
                Choose where to keep your notes. Each note is a plain Markdown file you fully own —
                stored in a folder on your computer, or{' '}
                {storage.isTauri ? 'inside the app' : 'inside this browser'}.
            </Text>
            <div className="folder-gate__actions">
                {storage.supportsFolders ? (
                    <Button
                        view="action"
                        size="l"
                        loading={storage.state === 'loading'}
                        onClick={() => void storage.pickFolder()}
                    >
                        Open a folder…
                    </Button>
                ) : null}
                <Button
                    view={storage.supportsFolders ? 'outlined' : 'action'}
                    size="l"
                    loading={storage.state === 'loading' && !storage.supportsFolders}
                    onClick={() => void storage.useBrowserStorage()}
                >
                    {storage.isTauri ? 'Store inside the app' : 'Store in this browser'}
                </Button>
            </div>
            {!storage.supportsFolders ? (
                <Text variant="caption-2" color="secondary">
                    Saving to a folder needs a Chromium browser (Chrome/Edge). You can move your
                    notes to a folder later by exporting them.
                </Text>
            ) : null}
        </>
    );
}
