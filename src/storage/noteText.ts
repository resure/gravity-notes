/**
 * Pure text/id helpers shared by every `NoteStore` backend (file-system, IndexedDB, …), so a note's
 * title derivation, filename sanitizing, canonical body shape, and list-preview snippet stay
 * identical no matter where the bytes live. No I/O lives here.
 */

export const MD_EXT = '.md';

/** Strip the `.md` extension to get a display title. */
export function titleFromFileName(name: string): string {
    return name.toLowerCase().endsWith(MD_EXT) ? name.slice(0, -MD_EXT.length) : name;
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

/** Turn a user-supplied title into a safe file-name base (no extension). */
export function sanitizeTitle(title: string): string {
    const cleaned = title
        .replace(/[/\\:*?"<>|]/g, ' ') // characters illegal in file names
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x1f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || 'Untitled';
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
