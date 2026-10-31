import {ATTACHMENTS_DIR, SKIP_DIR_NAMES, sanitizeDir} from './storage/noteText';

export interface NewFileSettings {
    folder: string | null;
}

export const DEFAULT_NEW_FILE_SETTINGS: NewFileSettings = {
    folder: null,
};

export function isValidNewFileFolder(folder: string): boolean {
    if (sanitizeDir(folder) !== folder) return false;
    const segments = folder.split('/');
    return (
        segments[0].toLowerCase() !== ATTACHMENTS_DIR.toLowerCase() &&
        !segments.some(
            (segment) => segment.startsWith('.') || SKIP_DIR_NAMES.includes(segment.toLowerCase()),
        )
    );
}

export function parseNewFileSettings(value: unknown): NewFileSettings {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {...DEFAULT_NEW_FILE_SETTINGS};
    }
    const raw = value as Partial<NewFileSettings>;
    const folder = raw.folder;
    return {
        folder: typeof folder === 'string' && isValidNewFileFolder(folder) ? folder : null,
    };
}
