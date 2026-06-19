import {Folder, TriangleExclamation} from '@gravity-ui/icons';
import {Button, Card, Icon, Text} from '@gravity-ui/uikit';

import type {NotesFolder} from '../hooks/useNotesFolder';

import './FolderGate.css';

/**
 * Full-screen gate shown until a notes folder is opened and permitted. Renders
 * the appropriate call-to-action for each non-ready state of {@link NotesFolder}.
 */
export function FolderGate({folder}: {folder: NotesFolder}) {
    return (
        <div className="folder-gate">
            <Card className="folder-gate__card" view="raised">
                <Content folder={folder} />
                {folder.error ? (
                    <Text color="danger" className="folder-gate__error">
                        {folder.error}
                    </Text>
                ) : null}
            </Card>
        </div>
    );
}

function Content({folder}: {folder: NotesFolder}) {
    if (folder.state === 'unsupported') {
        return (
            <>
                <Icon data={TriangleExclamation} size={32} className="folder-gate__icon" />
                <Text variant="header-1">Browser not supported</Text>
                <Text color="secondary">
                    Gravity Notes stores notes as <code>.md</code> files using the File System
                    Access API, which this browser doesn’t support. Please use a Chromium-based
                    browser such as Chrome or Edge.
                </Text>
            </>
        );
    }

    if (folder.state === 'needs-permission') {
        return (
            <>
                <Icon data={Folder} size={32} className="folder-gate__icon" />
                <Text variant="header-1">Reopen your notes</Text>
                <Text color="secondary">
                    Grant access to “{folder.folderName}” to continue editing your notes.
                </Text>
                <div className="folder-gate__actions">
                    <Button view="action" size="l" onClick={() => void folder.grantPermission()}>
                        Grant access
                    </Button>
                    <Button view="flat" size="l" onClick={() => void folder.forgetFolder()}>
                        Choose a different folder
                    </Button>
                </div>
            </>
        );
    }

    // 'needs-folder' (and 'loading' shows the same idle CTA briefly).
    return (
        <>
            <Icon data={Folder} size={32} className="folder-gate__icon" />
            <Text variant="header-1">Welcome to Gravity Notes</Text>
            <Text color="secondary">
                Choose a folder on your computer to keep your notes. Each note is saved as a plain
                Markdown file you fully own.
            </Text>
            <div className="folder-gate__actions">
                <Button
                    view="action"
                    size="l"
                    loading={folder.state === 'loading'}
                    onClick={() => void folder.pickFolder()}
                >
                    Open notes folder
                </Button>
            </div>
        </>
    );
}
