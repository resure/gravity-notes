import {describe, expect, it} from 'vitest';

import {
    FOLDER_MARKER,
    MD_EXT,
    basename,
    canonicalBody,
    dirname,
    joinPath,
    previewFromContent,
    sanitizeDir,
    sanitizeSegment,
    sanitizeTitle,
    stripTrailingNewlines,
    titleFromFileName,
    uniqueName,
} from './noteText';

describe('FOLDER_MARKER', () => {
    it('is a dotfile that is not a note (so list() which filters to .md ignores it)', () => {
        expect(FOLDER_MARKER).toBe('.gnkeep');
        expect(FOLDER_MARKER.startsWith('.')).toBe(true);
        expect(FOLDER_MARKER.endsWith(MD_EXT)).toBe(false);
    });
});

describe('basename', () => {
    it('returns a flat id unchanged (it is its own leaf)', () => {
        expect(basename('Ideas.md')).toBe('Ideas.md');
        expect(basename('Untitled')).toBe('Untitled');
    });

    it('returns the last path segment for a nested id', () => {
        expect(basename('Work/Roadmap.md')).toBe('Roadmap.md');
        expect(basename('Work/Sub/Deep Note.md')).toBe('Deep Note.md');
    });
});

describe('dirname', () => {
    it('is empty for a root-level (flat) id', () => {
        expect(dirname('Ideas.md')).toBe('');
    });

    it('is the POSIX folder path (no trailing slash) for a nested id', () => {
        expect(dirname('Work/Roadmap.md')).toBe('Work');
        expect(dirname('Work/Sub/Deep Note.md')).toBe('Work/Sub');
    });
});

describe('joinPath', () => {
    it('returns the bare leaf when the parent is root', () => {
        expect(joinPath('', 'Ideas.md')).toBe('Ideas.md');
    });

    it('joins a folder path and a leaf with a single slash', () => {
        expect(joinPath('Work', 'Roadmap.md')).toBe('Work/Roadmap.md');
        expect(joinPath('Work/Sub', 'Note.md')).toBe('Work/Sub/Note.md');
    });

    it('tolerates a trailing slash on the parent', () => {
        expect(joinPath('Work/', 'Note.md')).toBe('Work/Note.md');
        expect(joinPath('Work/Sub//', 'Note.md')).toBe('Work/Sub/Note.md');
    });

    it('round-trips with dirname + basename', () => {
        const id = 'Work/Sub/Note.md';
        expect(joinPath(dirname(id), basename(id))).toBe(id);
        const flat = 'Note.md';
        expect(joinPath(dirname(flat), basename(flat))).toBe(flat);
    });
});

describe('titleFromFileName', () => {
    it('strips .md from a flat id (unchanged behavior)', () => {
        expect(titleFromFileName('Ideas.md')).toBe('Ideas');
    });

    it('is basename-first: a nested id yields only the leaf title, never the folder prefix', () => {
        expect(titleFromFileName('Work/Roadmap.md')).toBe('Roadmap');
        expect(titleFromFileName('Work/Sub/Deep Note.md')).toBe('Deep Note');
    });

    it('preserves leaf casing while matching the extension case-insensitively', () => {
        expect(titleFromFileName('Work/ReadMe.MD')).toBe('ReadMe');
    });

    it('leaves a name with no .md extension intact', () => {
        expect(titleFromFileName('Work/no-extension')).toBe('no-extension');
        expect(titleFromFileName('no-extension')).toBe('no-extension');
    });
});

describe('sanitizeSegment', () => {
    it('squashes path separators so a typed title can never inject a folder boundary', () => {
        expect(sanitizeSegment('a/b\\c')).toBe('a b c');
    });

    it('replaces filesystem-illegal characters with spaces and collapses whitespace', () => {
        expect(sanitizeSegment('  Hello:  *World*?  ')).toBe('Hello World');
        expect(sanitizeSegment('a<b>c|d')).toBe('a b c d');
    });

    it('falls back to Untitled for an empty or all-illegal name', () => {
        expect(sanitizeSegment('')).toBe('Untitled');
        expect(sanitizeSegment('   ')).toBe('Untitled');
        expect(sanitizeSegment('///')).toBe('Untitled');
    });

    it('is the implementation behind the back-compat sanitizeTitle alias', () => {
        expect(sanitizeTitle).toBe(sanitizeSegment);
        expect(sanitizeTitle('Work/Plan')).toBe('Work Plan');
    });
});

describe('sanitizeDir', () => {
    it('is empty for the root', () => {
        expect(sanitizeDir('')).toBe('');
        expect(sanitizeDir('/')).toBe('');
    });

    it('cleans each segment and drops empty segments', () => {
        expect(sanitizeDir('Work')).toBe('Work');
        expect(sanitizeDir('Work/Sub')).toBe('Work/Sub');
        expect(sanitizeDir('/Work//Sub/')).toBe('Work/Sub');
    });

    it('drops "." and ".." segments so a folder path can never escape the root', () => {
        expect(sanitizeDir('Work/../Sub')).toBe('Work/Sub');
        expect(sanitizeDir('../../etc')).toBe('etc');
        expect(sanitizeDir('./Work/.')).toBe('Work');
    });

    it('keeps a dotted segment that is not exactly "." or ".."', () => {
        expect(sanitizeDir('..foo/.bar')).toBe('..foo/.bar');
    });

    it('sanitizes illegal characters within a segment', () => {
        expect(sanitizeDir('Work:1/Sub*2')).toBe('Work 1/Sub 2');
    });
});

describe('uniqueName', () => {
    const existsIn = (taken: Set<string>) => (candidate: string) =>
        Promise.resolve(taken.has(candidate));

    it('returns <base>.md when the name is free', async () => {
        expect(await uniqueName('Note', existsIn(new Set()))).toBe('Note.md');
    });

    it('appends " 2", " 3", … until the candidate is free', async () => {
        expect(await uniqueName('Note', existsIn(new Set(['Note.md'])))).toBe('Note 2.md');
        expect(await uniqueName('Note', existsIn(new Set(['Note.md', 'Note 2.md'])))).toBe(
            'Note 3.md',
        );
    });

    it('probes only the directory its caller scopes via exists (same leaf is free in another dir)', async () => {
        // The caller supplies a dir-scoped `exists`; uniqueName itself stays leaf-only.
        const workDir = new Set(['Note.md']);
        const archiveDir = new Set<string>();
        expect(await uniqueName('Note', existsIn(workDir))).toBe('Note 2.md');
        expect(await uniqueName('Note', existsIn(archiveDir))).toBe('Note.md');
    });
});

describe('canonicalBody / stripTrailingNewlines', () => {
    it('drops trailing newlines', () => {
        expect(stripTrailingNewlines('a\n\n\n')).toBe('a');
        expect(stripTrailingNewlines('a\nb')).toBe('a\nb');
    });

    it('ends a canonical body with exactly one blank line', () => {
        expect(canonicalBody('hello')).toBe('hello\n\n');
        expect(canonicalBody('hello\n\n\n')).toBe('hello\n\n');
    });
});

describe('previewFromContent', () => {
    it('flattens markdown markers and newlines into a single flowing snippet', () => {
        expect(previewFromContent('# Title\n\n- one\n- two')).toBe('Title one two');
    });

    it('renders preserved empty-row markers as spaces', () => {
        expect(previewFromContent('a\n\n&nbsp;\n\nb')).toBe('a b');
    });
});
