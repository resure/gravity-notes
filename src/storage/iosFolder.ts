/**
 * Thin TS wrappers over the in-tree `icloud-fs` Tauri plugin (iOS only). The plugin owns the two
 * native operations that plain `std::fs` can't do inside the iOS sandbox: presenting the Files
 * folder picker (returning a security-scoped bookmark) and re-resolving a saved bookmark on a later
 * launch. Once a folder is picked/resolved, the Swift side holds security-scoped access for the
 * app's lifetime, so the ordinary `TauriNoteStore` (the `notes_*` commands) reads/writes it as a
 * normal path — see `useNotesStorage`.
 */

import {folderNameFromPath} from './workspaceRegistry';

interface PickFolderResult {
    path: string | null;
    bookmark: string | null;
    name: string | null;
    cancelled: boolean;
}

interface ResolveBookmarkResult {
    path: string;
    bookmark: string;
    stale: boolean;
}

/** A folder the user picked on iOS: its current path, a persistable bookmark, and a display name. */
export interface IosFolder {
    path: string;
    bookmark: string;
    name: string;
}

/**
 * Present the iOS Files folder picker. Resolves to the picked folder (path + security-scoped
 * bookmark to persist) or `null` when the user cancels. Must run off a user gesture. iOS only.
 */
export async function pickIosFolder(): Promise<IosFolder | null> {
    const {invoke} = await import('@tauri-apps/api/core');
    const res = await invoke<PickFolderResult>('plugin:icloud-fs|pick_folder');
    if (res.cancelled || !res.path || !res.bookmark) return null;
    // Fall back to the folder's leaf name (matching the desktop pick path), never the whole POSIX
    // path — a full path as a workspace label would diverge from every other backend's naming.
    return {path: res.path, bookmark: res.bookmark, name: res.name ?? folderNameFromPath(res.path)};
}

/**
 * Re-resolve a saved bookmark, re-granting security-scoped access, and return the folder's current
 * path (the provider may have moved it) plus a possibly-refreshed bookmark to persist. iOS only.
 */
export async function resolveIosBookmark(
    bookmark: string,
): Promise<{path: string; bookmark: string}> {
    const {invoke} = await import('@tauri-apps/api/core');
    const res = await invoke<ResolveBookmarkResult>('plugin:icloud-fs|resolve_bookmark', {
        payload: {bookmark},
    });
    return {path: res.path, bookmark: res.bookmark};
}
