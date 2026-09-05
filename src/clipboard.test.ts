import {afterEach, describe, expect, it, vi} from 'vitest';

const shell = vi.hoisted(() => ({isTauri: false}));
const native = vi.hoisted(() => ({readText: vi.fn(), writeText: vi.fn()}));
vi.mock('./isTauri', () => shell);
vi.mock('@tauri-apps/plugin-clipboard-manager', () => native);

import {readClipboardText, writeClipboardText} from './clipboard';

afterEach(() => {
    shell.isTauri = false;
    vi.resetAllMocks();
    vi.unstubAllGlobals();
});

describe('system clipboard', () => {
    it('uses native text access in the shell, even without a browser Clipboard API', async () => {
        shell.isTauri = true;
        vi.stubGlobal('navigator', {});
        native.readText.mockResolvedValue('**native**');
        native.writeText.mockResolvedValue(undefined);
        expect(await readClipboardText()).toBe('**native**');
        await writeClipboardText('plain');
        expect(native.writeText).toHaveBeenCalledWith('plain');
    });

    it('calls the browser API immediately, within the user gesture', async () => {
        const readText = vi.fn().mockResolvedValue('**web**');
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', {clipboard: {readText, writeText}});
        const result = readClipboardText();
        expect(readText).toHaveBeenCalledOnce();
        expect(await result).toBe('**web**');
        const writing = writeClipboardText('plain');
        expect(writeText).toHaveBeenCalledWith('plain');
        await writing;
        expect(native.readText).not.toHaveBeenCalled();
    });

    it('propagates native failures for the editor to report', async () => {
        shell.isTauri = true;
        native.readText.mockRejectedValue(new Error('unavailable'));
        await expect(readClipboardText()).rejects.toThrow('unavailable');
    });
});
