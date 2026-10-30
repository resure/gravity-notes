import {afterEach, describe, expect, it, vi} from 'vitest';

import {
    DEFAULT_NEW_FILE_SETTINGS,
    type NewFileSettings,
    parseNewFileSettings,
    resolveNewFileCreation,
} from './newFiles';

afterEach(() => vi.unstubAllEnvs());

describe('new file settings', () => {
    it('keeps the current creation behavior by default', () => {
        expect(parseNewFileSettings(undefined)).toEqual(DEFAULT_NEW_FILE_SETTINGS);
        expect(resolveNewFileCreation(DEFAULT_NEW_FILE_SETTINGS)).toEqual({
            title: 'Untitled',
            parentPath: '',
            extension: '.md',
        });
        expect(
            resolveNewFileCreation(DEFAULT_NEW_FILE_SETTINGS, {selectedFolder: 'Work/Ideas'}),
        ).toMatchObject({parentPath: 'Work/Ideas'});
        expect(
            resolveNewFileCreation(DEFAULT_NEW_FILE_SETTINGS, {
                selectedFolder: 'Work/Ideas',
                parentPath: '',
            }),
        ).toMatchObject({parentPath: ''});
    });

    it('validates each persisted field independently', () => {
        expect(
            parseNewFileSettings({
                folder: 'Work/Ideas',
                extension: '',
                nameFormat: 'date-name',
                defaultName: 'Idea',
            }),
        ).toEqual({
            folder: 'Work/Ideas',
            extension: '',
            nameFormat: 'date-name',
            defaultName: 'Idea',
        });
        expect(
            parseNewFileSettings({
                folder: '',
                extension: '.json',
                nameFormat: 'arbitrary-template',
                defaultName: 42,
            }),
        ).toEqual({...DEFAULT_NEW_FILE_SETTINGS, folder: ''});
        for (const raw of [null, [], 'text', 42]) {
            expect(parseNewFileSettings(raw)).toEqual(DEFAULT_NEW_FILE_SETTINGS);
        }
    });

    it('rejects hidden, reserved, traversing and rewritten default folders', () => {
        for (const folder of [
            '.git',
            'Work/.hidden',
            '../Outside',
            '/Absolute',
            'Work/../Other',
            'Work//Ideas',
            ' Work ',
            'Attachments',
            'Work/node_modules',
            'Work\\Ideas',
        ]) {
            expect(parseNewFileSettings({folder}).folder).toBeNull();
        }
    });

    it.each(['', 'Inbox/Quick notes'])(
        'lets the configured folder %j override the selected folder and caller destination',
        (folder) => {
            expect(
                resolveNewFileCreation(
                    {...DEFAULT_NEW_FILE_SETTINGS, folder},
                    {selectedFolder: 'Selected', parentPath: 'Explicit'},
                ),
            ).toMatchObject({parentPath: folder});
        },
    );

    it.each(['.md', '.txt', ''] as const)(
        'passes the chosen extension %j to creation',
        (extension) => {
            expect(
                resolveNewFileCreation({...DEFAULT_NEW_FILE_SETTINGS, extension}).extension,
            ).toBe(extension);
        },
    );

    it('uses a custom default name and falls back from whitespace to Untitled', () => {
        expect(
            resolveNewFileCreation({...DEFAULT_NEW_FILE_SETTINGS, defaultName: '  Idea  '}).title,
        ).toBe('Idea');
        expect(
            resolveNewFileCreation({...DEFAULT_NEW_FILE_SETTINGS, defaultName: ' \t '}).title,
        ).toBe('Untitled');
    });

    it.each([
        ['name', 'Idea'],
        ['date', '2026-01-02'],
        ['date-name', '2026-01-02 - Idea'],
        ['datetime-name', '2026-01-02 030405 - Idea'],
    ] as const)('formats a blank creation with %s', (nameFormat, expected) => {
        expect(
            resolveNewFileCreation(
                {...DEFAULT_NEW_FILE_SETTINGS, nameFormat, defaultName: 'Idea'},
                {title: '  ', now: new Date(2026, 0, 2, 3, 4, 5)},
            ).title,
        ).toBe(expected);
    });

    it.each(['name', 'date', 'date-name', 'datetime-name'] as const)(
        'preserves an explicitly provided name with %s',
        (nameFormat: NewFileSettings['nameFormat']) => {
            expect(
                resolveNewFileCreation(
                    {...DEFAULT_NEW_FILE_SETTINGS, nameFormat, defaultName: 'Ignored'},
                    {title: '  Встреча  ', now: new Date(2026, 0, 2)},
                ).title,
            ).toBe('Встреча');
        },
    );

    it('formats dates in the local timezone rather than UTC', () => {
        vi.stubEnv('TZ', 'America/Los_Angeles');
        expect(
            resolveNewFileCreation(
                {...DEFAULT_NEW_FILE_SETTINGS, nameFormat: 'datetime-name'},
                {now: new Date('2026-10-30T00:30:00Z')},
            ).title,
        ).toBe('2026-10-29 173000 - Untitled');
    });
});
