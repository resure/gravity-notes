import {useCallback, useEffect, useState} from 'react';

import {
  clearDirHandle,
  loadDirHandle,
  queryPermission,
  requestPermission,
  saveDirHandle,
} from '../storage/handlePersistence';

export type FolderState =
  | 'loading' // checking for a previously-opened folder
  | 'unsupported' // browser lacks the File System Access API
  | 'needs-folder' // no folder chosen yet
  | 'needs-permission' // folder remembered, but permission must be re-granted
  | 'ready';

const isSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

export interface NotesFolder {
  state: FolderState;
  dir: FileSystemDirectoryHandle | null;
  /** Name of the remembered folder (for the re-grant prompt). */
  folderName: string | null;
  error: string | null;
  /** Open the system folder picker (must be triggered by a user gesture). */
  pickFolder(): Promise<void>;
  /** Re-request permission for the remembered folder (user gesture). */
  grantPermission(): Promise<void>;
  /** Forget the folder and return to the picker. */
  forgetFolder(): Promise<void>;
}

export function useNotesFolder(): NotesFolder {
  const [state, setState] = useState<FolderState>(isSupported ? 'loading' : 'unsupported');
  const [dir, setDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [folderName, setFolderName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // On load, try to recover the previously-opened folder.
  useEffect(() => {
    if (!isSupported) return;
    let cancelled = false;
    (async () => {
      const saved = await loadDirHandle();
      if (cancelled) return;
      if (!saved) {
        setState('needs-folder');
        return;
      }
      setFolderName(saved.name);
      if ((await queryPermission(saved)) === 'granted') {
        setDir(saved);
        setState('ready');
      } else {
        setState('needs-permission');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pickFolder = useCallback(async () => {
    setError(null);
    try {
      const handle = await window.showDirectoryPicker({id: 'gravity-notes', mode: 'readwrite'});
      if (!(await requestPermission(handle))) {
        setError('Permission to access the folder was denied.');
        return;
      }
      await saveDirHandle(handle);
      setDir(handle);
      setFolderName(handle.name);
      setState('ready');
    } catch (err) {
      // The user dismissing the picker throws AbortError — not an error to show.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Could not open the folder.');
    }
  }, []);

  const grantPermission = useCallback(async () => {
    setError(null);
    const saved = await loadDirHandle();
    if (!saved) {
      setState('needs-folder');
      return;
    }
    if (await requestPermission(saved)) {
      setDir(saved);
      setState('ready');
    } else {
      setError('Permission to access the folder was denied.');
    }
  }, []);

  const forgetFolder = useCallback(async () => {
    await clearDirHandle();
    setDir(null);
    setFolderName(null);
    setState('needs-folder');
  }, []);

  return {state, dir, folderName, error, pickFolder, grantPermission, forgetFolder};
}
