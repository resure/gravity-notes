import {useCallback, useMemo} from 'react';

import {Folder, Moon, Sun} from '@gravity-ui/icons';
import {Button, Icon, Label, Text, type Theme, useToaster} from '@gravity-ui/uikit';

import {useNotes, type SaveState} from '../hooks/useNotes';
import {FileSystemNoteStore} from '../storage/fileSystemStore';

import {EditorPane} from './EditorPane';
import {NoteList} from './NoteList';

import './Workspace.css';

interface WorkspaceProps {
  dir: FileSystemDirectoryHandle;
  folderName: string | null;
  theme: Theme;
  onToggleTheme: () => void;
  onChangeFolder: () => void;
}

const SAVE_LABEL: Record<SaveState, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save failed',
};

export function Workspace({dir, folderName, theme, onToggleTheme, onChangeFolder}: WorkspaceProps) {
  const store = useMemo(() => new FileSystemNoteStore(dir), [dir]);
  const {add} = useToaster();

  const onError = useCallback(
    (message: string) => {
      add({
        name: `notes-error-${Date.now()}`,
        title: 'Something went wrong',
        content: message,
        theme: 'danger',
        autoHiding: 5000,
      });
    },
    [add],
  );

  const notes = useNotes(store, onError);

  return (
    <div className="workspace">
      <header className="workspace__header">
        <div className="workspace__brand">
          <Text variant="subheader-2">Gravity Notes</Text>
          <Label theme="unknown" icon={<Icon data={Folder} size={14} />}>
            {folderName ?? 'Folder'}
          </Label>
        </div>
        <div className="workspace__header-right">
          <Text color="secondary" className="workspace__save-state">
            {SAVE_LABEL[notes.saveState]}
          </Text>
          <Button view="flat" size="m" onClick={onChangeFolder} title="Change folder">
            Change folder
          </Button>
          <Button
            view="flat"
            size="m"
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            <Icon data={theme === 'dark' ? Sun : Moon} />
          </Button>
        </div>
      </header>

      <div className="workspace__body">
        <aside className="workspace__sidebar">
          <NoteList
            notes={notes.notes}
            selectedId={notes.selectedId}
            onSelect={(id) => void notes.select(id)}
            onCreate={() => void notes.create()}
            onRename={(id, title) => void notes.rename(id, title)}
            onDelete={(id) => void notes.remove(id)}
          />
        </aside>

        <main className="workspace__editor">
          {notes.selectedNote ? (
            <EditorPane
              key={notes.selectedNote.id}
              note={notes.selectedNote}
              onChange={notes.edit}
            />
          ) : (
            <div className="workspace__placeholder">
              <Text variant="body-2" color="secondary">
                Select a note, or create a new one to start writing.
              </Text>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
