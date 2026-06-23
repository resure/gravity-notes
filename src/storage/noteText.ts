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
        .replace(/^\s{0,3}#{1,6}\s+/gm, '') // ATX heading markers
        .replace(/^\s*>\s?/gm, '') // blockquotes
        .replace(/^\s*[-*+]\s+/gm, '') // bullets
        .replace(/^\s*\d+\.\s+/gm, '') // ordered lists
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
