/**
 * Pure text/id helpers shared by every `NoteStore` backend (file-system, IndexedDB, …), so a note's
 * title derivation, filename sanitizing, canonical body shape, and list-preview snippet stay
 * identical no matter where the bytes live. No I/O lives here.
 */

export const MD_EXT = '.md';

/**
 * Marker file that keeps a deliberately-empty folder alive (it counts as folder *content*, so the
 * empty-ancestor prune leaves the folder in place). Git-familiar and visible in Finder. Not used
 * until first-class empty folders land; defined here so every layer shares the one spelling.
 */
export const FOLDER_MARKER = '.gnkeep';

/**
 * The single root-level folder that holds media attachments (images), one spelling shared by every
 * backend. An attachment reference inside a note's Markdown is always root-relative to this folder —
 * `Attachments/foo.png` — regardless of how deep the note itself is nested, so a note can move
 * between folders without its image links ever needing to be rewritten. The folder is excluded from
 * the note listing and the folder tree (it's storage, not a user folder).
 */
export const ATTACHMENTS_DIR = 'Attachments';

/** Whether a Markdown image `src` points at an in-vault attachment (vs. an external/data/blob URL). */
export function isAttachmentRef(src: string): boolean {
    return src.startsWith(`${ATTACHMENTS_DIR}/`);
}

/**
 * The single root-level folder that holds trashed (soft-deleted) notes, one spelling shared by every
 * backend. Deleting a note moves its `.md` file here instead of erasing it; the trash view restores
 * or permanently removes it. The leading dot is deliberate: every backend's note/folder walk already
 * skips dot-directories (`walkNotes`/`listFolders`, the Rust `collect_md`/`collect_folders`), so trash
 * is automatically excluded from the listing, the folder tree, the search corpus, and wiki-link
 * resolution with no extra filtering — and it stays hidden in Finder. A trashed note's id is
 * `.trash/<leaf>.md`; the original folder + deletion time live in the metadata sidecar, not on disk.
 */
export const TRASH_DIR = '.trash';

/**
 * Every distinct `Attachments/…` reference used as an image src in a note's Markdown. Drives both the
 * preview's blob-URL resolution and the management view's orphan (unreferenced) detection. Attachment
 * names are URL-safe (no spaces/parens — see {@link uniqueAttachmentName}), so a simple scan suffices.
 */
export function attachmentRefsIn(content: string): string[] {
    const refs = new Set<string>();
    // A Markdown image destination is either an angle-bracketed `<...>` (which may contain spaces) or
    // a bare token up to the next whitespace/`)`. Handle both so a hand-edited/imported note using the
    // `![](<Attachments/a b.png>)` form is still detected — otherwise such a ref would render broken
    // *and* be counted "unused" (deletable) by the attachments manager.
    for (const match of content.matchAll(/!\[[^\]]*\]\(\s*(?:<([^>]*)>|([^)\s]+))/g)) {
        const dest = (match[1] ?? match[2] ?? '').trim();
        if (isAttachmentRef(dest)) refs.add(dest);
    }
    return [...refs];
}

/**
 * The leaf (last `/` segment) of a note id. A flat id (no slash) is its own leaf, so this is a no-op
 * for non-nested notes.
 */
export function basename(id: string): string {
    const slash = id.lastIndexOf('/');
    return slash === -1 ? id : id.slice(slash + 1);
}

/**
 * The POSIX folder path of a note id, without a trailing slash; `''` for a root-level note. A flat
 * id yields `''`.
 */
export function dirname(id: string): string {
    const slash = id.lastIndexOf('/');
    return slash === -1 ? '' : id.slice(0, slash);
}

/** Join a POSIX folder path and a leaf into a note id. An empty `parent` means root. */
export function joinPath(parent: string, leaf: string): string {
    const dir = parent.replace(/\/+$/, '');
    return dir ? `${dir}/${leaf}` : leaf;
}

/** A folder path rendered as a readable crumb: `'Work/Sub'` → `'Work / Sub'`; `''` (root) stays `''`. */
export function formatCrumb(path: string): string {
    return path ? path.split('/').join(' / ') : '';
}

/**
 * Strip the `.md` extension off the *leaf* to get a display title. Basename-first, so a nested id
 * (`Work/Roadmap.md`) yields just `Roadmap`, never the folder prefix; a flat id is unaffected.
 */
export function titleFromFileName(name: string): string {
    const leaf = basename(name);
    return leaf.toLowerCase().endsWith(MD_EXT) ? leaf.slice(0, -MD_EXT.length) : leaf;
}

/** Trailing newlines are insignificant in Markdown; drop them for a canonical body. */
export function stripTrailingNewlines(text: string): string {
    return text.replace(/\n+$/, '');
}

/** Canonical on-disk body: the body followed by a single blank line at EOF. */
export function canonicalBody(content: string): string {
    return stripTrailingNewlines(content) + '\n\n';
}

/** How many bytes/chars of each file to scan for the list preview snippet. */
export const PREVIEW_SCAN_BYTES = 500;

/**
 * A single flowing snippet of the body for the list preview: Markdown markers stripped,
 * newlines (and hard-break backslashes) collapsed into spaces so nothing renders literally;
 * the list cell ellipsizes the visible overflow.
 */
export function previewFromContent(text: string): string {
    return text
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images → drop (no alt text in the flowing preview)
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → keep just the link text
        .replace(/\[\[([^[\]\n]+)\]\]/g, '$1') // [[wiki links]] → their title, as the editor shows them
        .replace(/^\s{0,3}#{1,6}\s+/gm, '') // ATX heading markers
        .replace(/^\s*>\s?/gm, '') // blockquotes
        .replace(/^\s*[-*+]\s+/gm, '') // bullets
        .replace(/^\s*\d+\.\s+/gm, '') // ordered lists
        .replace(/\\([^\sA-Za-z0-9])/g, '$1') // drop CommonMark backslash-escapes (e.g. 0\. → 0.)
        .replace(/[*_`~]/g, '') // inline emphasis / code / strike
        .replace(/\\$/gm, '') // hard-line-break backslashes
        .replace(/&nbsp;/g, ' ') // preserved empty-row markers (see EditorPane preserveEmptyRows)
        .replace(/\s+/g, ' ') // flow newlines + indentation into single spaces
        .trim()
        .slice(0, 140);
}

/**
 * Turn a user-supplied title into a safe file-name *segment* (one leaf or one folder name, no
 * extension). Path separators are squashed to spaces, so a typed title can never inject a folder
 * boundary — nesting only ever comes from an explicit path join, never from the text of a name.
 */
export function sanitizeSegment(title: string): string {
    const cleaned = title
        .replace(/[/\\:*?"<>|]/g, ' ') // characters illegal in file names (incl. path separators)
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x1f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || 'Untitled';
}

/**
 * Back-compat alias: a note *title* is exactly one leaf segment. Existing `create`/`rename` call
 * sites keep calling `sanitizeTitle`; nesting is expressed by joining a separately-sanitized folder
 * path, never by what the user types into a title.
 */
export const sanitizeTitle = sanitizeSegment;

/**
 * Whether a folder-name segment collides with storage the backends own and hide from the tree —
 * the root `Attachments/` media folder, or any dot-prefixed name (`.trash`, the `.gravity-notes.json`
 * sidecar, `.gnkeep`, …), all of which the note/folder walks deliberately skip. A *user* folder with
 * such a name would exist on disk but be invisible in the app (its notes would vanish from the tree
 * yet still feed search). Folder create/rename/move reject these so that can't happen.
 *
 * The `Attachments` check is case-INSENSITIVE on purpose: the backends the app targets (macOS desktop,
 * macOS/Windows Chromium) all sit on case-insensitive filesystems, where `attachments` / `ATTACHMENTS`
 * resolve to the very same directory as the `Attachments/` media store — so every casing must be
 * reserved. (On a rare case-sensitive volume the exact-case walk wouldn't hide a lowercase folder, so
 * this conservatively over-reserves there; preferable to silently merging a user folder into media
 * storage on the common case.)
 */
export function isReservedSegment(segment: string): boolean {
    const trimmed = segment.trim();
    return trimmed.startsWith('.') || trimmed.toLowerCase() === ATTACHMENTS_DIR.toLowerCase();
}

/**
 * Clean a user-supplied POSIX-relative folder path: sanitize each segment, and drop empty, `.`, and
 * `..` segments so a folder path can never escape the notes root. Returns `''` for the root.
 */
export function sanitizeDir(relDir: string): string {
    return relDir
        .split('/')
        .map((segment) => segment.trim())
        .filter((segment) => segment !== '' && segment !== '.' && segment !== '..')
        .map(sanitizeSegment)
        .join('/');
}

/**
 * Resolve `<base>.md`, appending " 2", " 3", … until `exists` reports the candidate is free.
 * Bounded so a pathological store (every candidate taken) can't spin forever.
 */
export async function uniqueName(
    base: string,
    exists: (candidate: string) => Promise<boolean>,
): Promise<string> {
    for (let i = 1; i <= 100000; i++) {
        const candidate = (i === 1 ? base : `${base} ${i}`) + MD_EXT;
        if (!(await exists(candidate))) {
            return candidate;
        }
    }
    throw new Error(`Could not find a free file name for "${base}"`);
}

/**
 * Split a file name into `[base, ext]`, where `ext` includes the leading dot (`foo.png` →
 * `['foo', '.png']`). A name with no dot, or a leading-dot dotfile (`.gnkeep`), has no extension.
 */
export function splitExt(name: string): [base: string, ext: string] {
    const dot = name.lastIndexOf('.');
    return dot <= 0 ? [name, ''] : [name.slice(0, dot), name.slice(dot)];
}

/**
 * Resolve a free attachment file name, preserving the original extension and appending "-2", "-3", …
 * to the base on collision (`foo.png` → `foo-2.png`). The base is sanitized like a note title and
 * then made URL-safe — whitespace, parentheses, and brackets collapse to hyphens — so the Markdown
 * image link (`![](Attachments/<name>)`) needs no escaping and round-trips through any Markdown
 * renderer (an unescaped space or `)` would otherwise break the link). The extension is kept verbatim.
 */
export async function uniqueAttachmentName(
    desiredName: string,
    exists: (candidate: string) => Promise<boolean>,
): Promise<string> {
    const [rawBase, ext] = splitExt(desiredName);
    const cleaned = sanitizeSegment(rawBase)
        .replace(/[()[\]\s]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
    const base = cleaned || 'file';
    for (let i = 1; i <= 100000; i++) {
        const candidate = (i === 1 ? base : `${base}-${i}`) + ext;
        if (!(await exists(candidate))) {
            return candidate;
        }
    }
    throw new Error(`Could not find a free file name for "${desiredName}"`);
}

const MIME_BY_EXT: Readonly<Record<string, string>> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
};

/**
 * Best-effort MIME type for a file name's extension, used to tag a `Blob` rebuilt from raw bytes (the
 * Tauri backend reads bytes without a stored type). Empty string when unknown — browsers still sniff
 * image content for `<img>`, so an unknown type is harmless.
 */
export function mimeFromName(name: string): string {
    const [, ext] = splitExt(name);
    return MIME_BY_EXT[ext.toLowerCase()] ?? '';
}
