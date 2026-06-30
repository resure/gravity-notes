import {useCallback, useRef, useState} from 'react';

import type {Update} from '@tauri-apps/plugin-updater';

import {isTauri} from '../isTauri';

// The whole feature no-ops outside the native shell (isTauri === false); every Tauri API below is
// reached via dynamic `import()` so it never enters the browser bundle (mirrors the plugin-dialog
// convention).

export type UpdaterStatus =
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'installed'
    | 'restart-required'
    | 'error';

export interface UpdateInfo {
    /** The available version (from the release's `latest.json`). */
    version: string;
    /** The version currently running. */
    currentVersion: string;
    /** Release notes (the manifest's `notes`, surfaced by the updater as `body`), if any. */
    notes?: string;
    /** Publish date, if the manifest carried one. */
    date?: string;
}

export interface UpdateProgress {
    /** Bytes downloaded so far. */
    downloaded: number;
    /** Total bytes, or null when the server reported no content length. */
    total: number | null;
}

export interface AppUpdater {
    /** Whether the updater can run at all (the native shell). Always false in the browser build. */
    supported: boolean;
    status: UpdaterStatus;
    /** Set right after a check that found nothing — drives the manual "You're up to date" message. */
    upToDate: boolean;
    /** The running app version, once a check has resolved it (for the "up to date" message). */
    currentVersion: string | null;
    info: UpdateInfo | null;
    progress: UpdateProgress | null;
    error: string | null;
    /** Which phase the current error came from, so the dialog can word it (a failed check vs install). */
    errorContext: 'check' | 'install' | null;
    /**
     * Check for an update; resolves to the available update's info, or null (up-to-date / error /
     * not supported). `silent` swallows lookup/network errors (used by the on-launch check) instead
     * of surfacing the `error` state. Returning the info lets the caller name the version without
     * racing the async state update.
     */
    check: (opts?: {silent?: boolean}) => Promise<UpdateInfo | null>;
    /** Download + install the pending update, then relaunch into the new version. */
    install: () => Promise<void>;
}

/**
 * The in-app auto-updater (macOS desktop). Wraps the Tauri updater/process plugins behind a small
 * state machine so the UI can render a check → available → downloading → relaunch flow. Holds the
 * found `Update` handle in a ref between {@link AppUpdater.check} and {@link AppUpdater.install}; a
 * single `busy` ref serializes the two so a manual check can't race the on-launch one. All actions
 * are stable (empty-dep `useCallback`s), so the on-mount launch check in `Workspace` runs once.
 */
export function useAppUpdater(): AppUpdater {
    const [status, setStatus] = useState<UpdaterStatus>('idle');
    const [upToDate, setUpToDate] = useState(false);
    const [currentVersion, setCurrentVersion] = useState<string | null>(null);
    const [info, setInfo] = useState<UpdateInfo | null>(null);
    const [progress, setProgress] = useState<UpdateProgress | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [errorContext, setErrorContext] = useState<'check' | 'install' | null>(null);
    // The update found by check(), kept until install() consumes it (or a later check replaces it).
    const updateRef = useRef<Update | null>(null);
    // Serializes check()/install() — the launch check and a manual check (or install) can overlap.
    const busyRef = useRef(false);

    const check = useCallback<AppUpdater['check']>(async (opts) => {
        if (!isTauri || busyRef.current) return null;
        busyRef.current = true;
        setUpToDate(false);
        setError(null);
        setErrorContext(null);
        setStatus('checking');
        try {
            const {check: runCheck} = await import('@tauri-apps/plugin-updater');
            // Drop any previously-found-but-uninstalled handle before replacing it (frees the Rust
            // resource); ignore close errors — a stale handle is harmless.
            await updateRef.current?.close().catch(() => {});
            updateRef.current = null;
            const update = await runCheck();
            if (!update) {
                setInfo(null);
                // No Update handle means no version to read from it — ask the app shell directly so
                // the "you're up to date" message can name the running version.
                const {getVersion} = await import('@tauri-apps/api/app');
                setCurrentVersion(await getVersion().catch(() => null));
                setStatus('idle');
                setUpToDate(true);
                return null;
            }
            updateRef.current = update;
            const found: UpdateInfo = {
                version: update.version,
                currentVersion: update.currentVersion,
                notes: update.body,
                date: update.date,
            };
            setCurrentVersion(update.currentVersion);
            setInfo(found);
            setStatus('available');
            return found;
        } catch {
            // The lookup failed: offline, GitHub unreachable, or — before the first updater-carrying
            // release exists — no latest.json published yet (a 404 on the endpoint).
            if (opts?.silent) {
                // On-launch check: stay quiet and return to idle.
                setStatus('idle');
                return null;
            }
            setError(
                'Couldn’t check for updates — you may be offline, or no update has been published yet.',
            );
            setErrorContext('check');
            setStatus('error');
            return null;
        } finally {
            busyRef.current = false;
        }
    }, []);

    const install = useCallback<AppUpdater['install']>(async () => {
        const update = updateRef.current;
        if (!isTauri || !update || busyRef.current) return;
        busyRef.current = true;
        setError(null);
        setErrorContext(null);
        setProgress({downloaded: 0, total: null});
        setStatus('downloading');
        try {
            await update.downloadAndInstall((event) => {
                if (event.event === 'Started') {
                    setProgress({downloaded: 0, total: event.data.contentLength ?? null});
                } else if (event.event === 'Progress') {
                    setProgress((prev) => ({
                        downloaded: (prev?.downloaded ?? 0) + event.data.chunkLength,
                        total: prev?.total ?? null,
                    }));
                } else if (event.event === 'Finished') {
                    // Pin the bar to 100% — the last Progress chunk leaves it just short.
                    setProgress((prev) =>
                        prev && prev.total !== null ? {...prev, downloaded: prev.total} : prev,
                    );
                }
            });
        } catch (err) {
            // Download/install failed — nothing was swapped in. The found handle is kept, so the
            // dialog can retry install() on it.
            setError(err instanceof Error ? err.message : 'Update failed to install');
            setErrorContext('install');
            setStatus('error');
            busyRef.current = false;
            return;
        }
        // Installed on disk. Relaunch is a SEPARATE step: a failure here means "installed but couldn't
        // restart" — NOT an install failure — so ask for a manual restart instead of showing an error.
        setStatus('installed');
        try {
            const {relaunch} = await import('@tauri-apps/plugin-process');
            await relaunch(); // replaces the running process on success — nothing after this runs
        } catch {
            setStatus('restart-required');
        } finally {
            busyRef.current = false;
        }
    }, []);

    return {
        supported: isTauri,
        status,
        upToDate,
        currentVersion,
        info,
        progress,
        error,
        errorContext,
        check,
        install,
    };
}
