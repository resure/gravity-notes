import {isTauri} from './isTauri';

/** Native shells use the OS clipboard; browsers require a secure context and a key gesture. */
export function readClipboardText(): Promise<string> {
    if (isTauri) {
        return import('@tauri-apps/plugin-clipboard-manager').then((clipboard) =>
            clipboard.readText(),
        );
    }
    return navigator.clipboard.readText();
}

export function writeClipboardText(text: string): Promise<void> {
    if (isTauri) {
        return import('@tauri-apps/plugin-clipboard-manager').then((clipboard) =>
            clipboard.writeText(text),
        );
    }
    return navigator.clipboard.writeText(text);
}
