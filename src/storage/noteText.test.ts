import {describe, expect, it} from 'vitest';

import {
    ATTACHMENTS_DIR,
    FOLDER_MARKER,
    MD_EXT,
    attachmentRefsIn,
    basename,
    canonicalBody,
    dirname,
    isAttachmentRef,
    joinPath,
    mimeFromName,
    previewFromContent,
    sanitizeDir,
    sanitizeImportDir,
    sanitizeSegment,
    sanitizeTitle,
    splitExt,
    stripTrailingNewlines,
    titleFromFileName,
    uniqueAttachmentName,
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

describe('sanitizeImportDir', () => {
    it('de-reserves segments the walk would hide so imported notes stay visible', () => {
        // Dot-dirs lose their leading dots; reserved media/skip names get a `_` suffix.
        expect(sanitizeImportDir('.git/Notes')).toBe('git/Notes');
        expect(sanitizeImportDir('node_modules/pkg')).toBe('node_modules_/pkg');
        expect(sanitizeImportDir('Attachments/sub')).toBe('Attachments_/sub');
        expect(sanitizeImportDir('NODE_MODULES')).toBe('NODE_MODULES_'); // case-insensitive
    });

    it('leaves ordinary folder paths untouched and still strips traversal', () => {
        expect(sanitizeImportDir('Work/Sub')).toBe('Work/Sub');
        expect(sanitizeImportDir('../../etc/Work')).toBe('etc/Work');
        expect(sanitizeImportDir('')).toBe('');
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

    it('drops image syntax and keeps just link text', () => {
        expect(previewFromContent('See ![a cat](Attachments/cat.png) here')).toBe('See here');
        expect(previewFromContent('Read the [docs](https://example.com) now')).toBe(
            'Read the docs now',
        );
    });

    it('unescapes CommonMark backslash-escapes so they do not show literally', () => {
        // The editor stores a paragraph that begins with "0." as "0\\." so it isn't re-parsed as a
        // list; the preview should show "0." as text, without the stray backslash.
        expect(previewFromContent('0\\. Mental model: the three big shifts')).toBe(
            '0. Mental model: the three big shifts',
        );
        // A real ordered-list marker is still stripped — only the escaped, literal one survives.
        expect(previewFromContent('1. First\n2. Second')).toBe('First Second');
    });

    it('shows a [[wiki link]] as its bare title', () => {
        expect(previewFromContent('Back to [[Roadmap]] for the plan')).toBe(
            'Back to Roadmap for the plan',
        );
    });
});

describe('isAttachmentRef', () => {
    it('matches root-relative Attachments paths only', () => {
        expect(isAttachmentRef(`${ATTACHMENTS_DIR}/cat.png`)).toBe(true);
        expect(isAttachmentRef('https://example.com/cat.png')).toBe(false);
        expect(isAttachmentRef('data:image/png;base64,AAAA')).toBe(false);
        expect(isAttachmentRef('blob:http://localhost/abc')).toBe(false);
        // A nested folder that merely ends in "Attachments" is not the root media folder.
        expect(isAttachmentRef('Work/Attachments/cat.png')).toBe(false);
    });
});

describe('attachmentRefsIn', () => {
    it('collects distinct attachment image refs, ignoring external images and links', () => {
        const md =
            '![a](Attachments/cat.png)\n\n![b](https://x/y.png)\n\n[link](Attachments/not-an-image.png)\n\n![c](Attachments/cat.png) ![d](Attachments/dog.png)';
        expect(attachmentRefsIn(md).sort()).toEqual(['Attachments/cat.png', 'Attachments/dog.png']);
    });

    it('returns an empty array when there are no attachment images', () => {
        expect(attachmentRefsIn('# Title\n\njust text')).toEqual([]);
    });
});

describe('splitExt', () => {
    it('splits the trailing extension, keeping the dot', () => {
        expect(splitExt('foo.png')).toEqual(['foo', '.png']);
        expect(splitExt('a.b.jpeg')).toEqual(['a.b', '.jpeg']);
    });

    it('treats a dotless name or a leading-dot dotfile as having no extension', () => {
        expect(splitExt('README')).toEqual(['README', '']);
        expect(splitExt('.gnkeep')).toEqual(['.gnkeep', '']);
    });
});

describe('uniqueAttachmentName', () => {
    const existsIn = (taken: Set<string>) => (candidate: string) =>
        Promise.resolve(taken.has(candidate));

    it('keeps the extension and returns the name unchanged when free', async () => {
        expect(await uniqueAttachmentName('photo.png', existsIn(new Set()))).toBe('photo.png');
    });

    it('appends "-2", "-3", … to the base (before the extension) on collision', async () => {
        expect(await uniqueAttachmentName('photo.png', existsIn(new Set(['photo.png'])))).toBe(
            'photo-2.png',
        );
        expect(
            await uniqueAttachmentName(
                'photo.png',
                existsIn(new Set(['photo.png', 'photo-2.png'])),
            ),
        ).toBe('photo-3.png');
    });

    it('makes the base URL-safe (no spaces/parens/brackets that would break the link)', async () => {
        expect(await uniqueAttachmentName('a/b:c.png', existsIn(new Set()))).toBe('a-b-c.png');
        expect(await uniqueAttachmentName('my pic.png', existsIn(new Set()))).toBe('my-pic.png');
        expect(await uniqueAttachmentName('shot (1).png', existsIn(new Set()))).toBe('shot-1.png');
    });
});

describe('mimeFromName', () => {
    it('maps known image extensions (case-insensitively) and empty-strings the unknown', () => {
        expect(mimeFromName('cat.PNG')).toBe('image/png');
        expect(mimeFromName('cat.jpg')).toBe('image/jpeg');
        expect(mimeFromName('cat.svg')).toBe('image/svg+xml');
        expect(mimeFromName('cat.xyz')).toBe('');
        expect(mimeFromName('noext')).toBe('');
    });
});
