import {describe, expect, it} from 'vitest';

import {DEFAULT_NEW_FILE_SETTINGS, parseNewFileSettings} from './newFiles';

describe('new file settings', () => {
    it('uses the current folder by default and tolerates invalid settings', () => {
        for (const raw of [undefined, null, [], 'text', 42]) {
            expect(parseNewFileSettings(raw)).toEqual(DEFAULT_NEW_FILE_SETTINGS);
        }
    });

    it.each(['', 'Work/Ideas'])(
        'preserves the configured destination %j and ignores removed filename settings',
        (folder) => {
            expect(
                parseNewFileSettings({
                    folder,
                    extension: '.txt',
                    nameFormat: 'date-name',
                    defaultName: 'Idea',
                }),
            ).toEqual({folder});
        },
    );

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
            'attachments/Inbox',
            'ATTACHMENTS',
            'Work/node_modules',
            'Work/NODE_MODULES/Sub',
            'Q1?',
            'Work/Q1?',
            'Work\\Ideas',
        ]) {
            expect(parseNewFileSettings({folder}).folder).toBeNull();
        }
    });

    it.each(['Work/Attachments', 'Work/attachments/Ideas'])(
        'preserves an existing nested media-named folder %j after reopening',
        (folder) => {
            const loaded = parseNewFileSettings({folder});
            expect(loaded).toEqual({folder});
            expect(parseNewFileSettings(JSON.parse(JSON.stringify(loaded)))).toEqual({folder});
        },
    );
});
