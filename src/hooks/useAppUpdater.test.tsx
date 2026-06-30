import {getVersion} from '@tauri-apps/api/app';
import {relaunch} from '@tauri-apps/plugin-process';
import {type Update, check} from '@tauri-apps/plugin-updater';
import {act, renderHook} from '@testing-library/react';
import {afterAll, beforeEach, describe, expect, it, vi} from 'vitest';

import {useAppUpdater} from './useAppUpdater';

// Force the module to read as the Tauri desktop shell: `isTauri` (src/isTauri.ts) is computed once at
// module-eval from `'__TAURI_INTERNALS__' in window`. vi.hoisted runs before the imports above (vitest
// hoists it), so the flag is set before `useAppUpdater` → `isTauri` evaluates.
vi.hoisted(() => {
    (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {};
});

// The hook reaches the plugins only via dynamic import(); mock each (vi.mock is hoisted above the
// imports) so no native bridge is needed.
vi.mock('@tauri-apps/plugin-updater', () => ({check: vi.fn()}));
vi.mock('@tauri-apps/api/app', () => ({getVersion: vi.fn()}));
vi.mock('@tauri-apps/plugin-process', () => ({relaunch: vi.fn()}));

const checkMock = vi.mocked(check);
const getVersionMock = vi.mocked(getVersion);
const relaunchMock = vi.mocked(relaunch);

type DownloadEvent =
    | {event: 'Started'; data: {contentLength?: number}}
    | {event: 'Progress'; data: {chunkLength: number}}
    | {event: 'Finished'};

/** A stand-in for the plugin's `Update`, with just the fields/methods the hook touches. */
function makeUpdate(
    downloadAndInstall?: (cb?: (e: DownloadEvent) => void) => Promise<void>,
): Update {
    return {
        version: '1.2.0',
        currentVersion: '1.1.0',
        body: 'Shiny new things',
        date: '2026-06-30',
        close: vi.fn().mockResolvedValue(undefined),
        downloadAndInstall:
            downloadAndInstall ??
            vi.fn(async (cb?: (e: DownloadEvent) => void) => {
                cb?.({event: 'Started', data: {contentLength: 100}});
                cb?.({event: 'Progress', data: {chunkLength: 60}});
                cb?.({event: 'Progress', data: {chunkLength: 40}});
                cb?.({event: 'Finished'});
            }),
    } as unknown as Update;
}

beforeEach(() => {
    vi.clearAllMocks();
    getVersionMock.mockResolvedValue('1.1.0');
    relaunchMock.mockResolvedValue(undefined);
});

afterAll(() => {
    delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe('useAppUpdater', () => {
    it('reports as supported in the Tauri shell and starts idle', () => {
        const {result} = renderHook(() => useAppUpdater());
        expect(result.current.supported).toBe(true);
        expect(result.current.status).toBe('idle');
    });

    it('check() surfaces an available update and returns its info', async () => {
        checkMock.mockResolvedValue(makeUpdate());
        const {result} = renderHook(() => useAppUpdater());

        let returned;
        await act(async () => {
            returned = await result.current.check();
        });

        expect(result.current.status).toBe('available');
        expect(result.current.info).toMatchObject({
            version: '1.2.0',
            currentVersion: '1.1.0',
            notes: 'Shiny new things',
        });
        // The return value lets Workspace name the version in its launch toast without racing state.
        expect(returned).toMatchObject({version: '1.2.0'});
    });

    it('check() with no update → up to date, naming the running version', async () => {
        checkMock.mockResolvedValue(null);
        getVersionMock.mockResolvedValue('1.1.0');
        const {result} = renderHook(() => useAppUpdater());

        let returned;
        await act(async () => {
            returned = await result.current.check();
        });

        expect(result.current.status).toBe('idle');
        expect(result.current.upToDate).toBe(true);
        expect(result.current.currentVersion).toBe('1.1.0');
        expect(returned).toBeNull();
    });

    it('a non-silent check failure surfaces a gentle error (errorContext = check)', async () => {
        checkMock.mockRejectedValue(new Error('network down'));
        const {result} = renderHook(() => useAppUpdater());

        await act(async () => {
            await result.current.check();
        });

        expect(result.current.status).toBe('error');
        expect(result.current.errorContext).toBe('check');
        expect(result.current.error).toMatch(/check for updates/i);
    });

    it('a silent check failure stays quiet (idle, no error surfaced)', async () => {
        checkMock.mockRejectedValue(new Error('offline'));
        const {result} = renderHook(() => useAppUpdater());

        await act(async () => {
            await result.current.check({silent: true});
        });

        expect(result.current.status).toBe('idle');
        expect(result.current.error).toBeNull();
    });

    it('install() downloads to 100% then relaunches', async () => {
        checkMock.mockResolvedValue(makeUpdate());
        const {result} = renderHook(() => useAppUpdater());
        await act(async () => {
            await result.current.check();
        });

        await act(async () => {
            await result.current.install();
        });

        expect(result.current.status).toBe('installed');
        // The 'Finished' event pins the bar to 100% (the last chunk leaves it just short).
        expect(result.current.progress).toEqual({downloaded: 100, total: 100});
        expect(relaunchMock).toHaveBeenCalledTimes(1);
    });

    it('install succeeds but relaunch fails → restart-required, not an error', async () => {
        checkMock.mockResolvedValue(makeUpdate());
        relaunchMock.mockRejectedValue(new Error('cannot relaunch'));
        const {result} = renderHook(() => useAppUpdater());
        await act(async () => {
            await result.current.check();
        });

        await act(async () => {
            await result.current.install();
        });

        expect(result.current.status).toBe('restart-required');
        expect(result.current.error).toBeNull();
    });

    it('a failed install is retryable on the still-held handle', async () => {
        const downloadAndInstall = vi
            .fn()
            .mockRejectedValueOnce(new Error('disk full'))
            .mockImplementationOnce(async (cb?: (e: DownloadEvent) => void) => {
                cb?.({event: 'Started', data: {contentLength: 10}});
                cb?.({event: 'Finished'});
            });
        checkMock.mockResolvedValue(makeUpdate(downloadAndInstall));
        const {result} = renderHook(() => useAppUpdater());
        await act(async () => {
            await result.current.check();
        });

        await act(async () => {
            await result.current.install();
        });
        expect(result.current.status).toBe('error');
        expect(result.current.errorContext).toBe('install');

        // The Update handle is retained, so a second install() (the dialog's "Try again") succeeds.
        await act(async () => {
            await result.current.install();
        });
        expect(result.current.status).toBe('installed');
        expect(relaunchMock).toHaveBeenCalledTimes(1);
    });
});
