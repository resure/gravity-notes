import {isReservedSegment, sanitizeDir} from './storage/noteText';

export interface NewFileSettings {
    folder: string | null;
    extension: '.md' | '.txt' | '';
    nameFormat: 'name' | 'date' | 'date-name' | 'datetime-name';
    defaultName: string;
}

export const DEFAULT_NEW_FILE_SETTINGS: NewFileSettings = {
    folder: null,
    extension: '.md',
    nameFormat: 'name',
    defaultName: '',
};

const EXTENSIONS: readonly NewFileSettings['extension'][] = ['.md', '.txt', ''];
const NAME_FORMATS: readonly NewFileSettings['nameFormat'][] = [
    'name',
    'date',
    'date-name',
    'datetime-name',
];

export function parseNewFileSettings(value: unknown): NewFileSettings {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {...DEFAULT_NEW_FILE_SETTINGS};
    }
    const raw = value as Partial<NewFileSettings>;
    const folder = raw.folder;
    return {
        folder:
            typeof folder === 'string' &&
            sanitizeDir(folder) === folder &&
            !folder.split('/').some(isReservedSegment)
                ? folder
                : null,
        extension: EXTENSIONS.includes(raw.extension as NewFileSettings['extension'])
            ? (raw.extension as NewFileSettings['extension'])
            : DEFAULT_NEW_FILE_SETTINGS.extension,
        nameFormat: NAME_FORMATS.includes(raw.nameFormat as NewFileSettings['nameFormat'])
            ? (raw.nameFormat as NewFileSettings['nameFormat'])
            : DEFAULT_NEW_FILE_SETTINGS.nameFormat,
        defaultName:
            typeof raw.defaultName === 'string'
                ? raw.defaultName
                : DEFAULT_NEW_FILE_SETTINGS.defaultName,
    };
}

interface NewFileCreationInput {
    title?: string;
    parentPath?: string;
    selectedFolder?: string | null;
    now?: Date;
}

export function resolveNewFileCreation(
    settings: NewFileSettings,
    {title, parentPath, selectedFolder, now = new Date()}: NewFileCreationInput = {},
): {title: string; parentPath: string; extension: NewFileSettings['extension']} {
    let name = title?.trim();
    if (!name) {
        name = settings.defaultName.trim() || 'Untitled';
        if (settings.nameFormat !== 'name') {
            if (!Number.isFinite(now.getTime())) throw new RangeError('Invalid new-file date');
            const pad = (part: number) => String(part).padStart(2, '0');
            const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
            if (settings.nameFormat === 'date') name = date;
            else if (settings.nameFormat === 'date-name') name = `${date} - ${name}`;
            else {
                const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
                name = `${date} ${time} - ${name}`;
            }
        }
    }
    return {
        title: name,
        parentPath: settings.folder ?? parentPath ?? selectedFolder ?? '',
        extension: settings.extension,
    };
}
