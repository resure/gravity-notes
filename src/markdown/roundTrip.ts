/**
 * The safety property that makes the block editor safe to point at somebody's real notes.
 *
 * The block engine has no incremental edit model: every keystroke re-serializes the WHOLE document
 * through `blocksToMarkdown`, so the file it writes is a function of what `markdownToBlocks`
 * understood — not of what the user touched. Any construct the parser reads imperfectly is therefore
 * rewritten across the whole note the first time a single character changes anywhere in it, silently
 * and with no undo once autosave lands.
 *
 * `fromMarkdown` is a small line-oriented parser, not CommonMark. It recognises what `toMarkdown`
 * writes, and that pair is a fixed point by construction — but a `.md` file is arbitrary input,
 * written by hand, by Obsidian, or by this app's own Markdown engine, and the parser cannot be
 * complete against all of it. Every gap is a way to corrupt a file.
 *
 * So instead of trusting the parser, we CHECK it, per note, at load: re-serialize what we parsed and
 * compare it against the bytes on disk. If they differ, this note has something the block model
 * cannot carry losslessly, and the caller opens it in the Markdown engine instead. A construct we
 * never anticipated becomes a visible fallback rather than silent data loss — which is the right
 * failure mode for a surface whose output overwrites the user's files.
 */

import type {Block} from '../components/blockEditor/types';

import {markdownToBlocks} from './fromMarkdown';
import {blocksToMarkdown} from './toMarkdown';

/**
 * Whether `markdown` survives a parse/serialize cycle byte-for-byte, i.e. whether the block editor
 * can hold this note without rewriting parts of it the user never edited.
 *
 * Compared against the same canonical form the storage layer writes (`blocksToMarkdown` trims, so a
 * note's trailing newline is not a difference worth refusing over).
 */
export function isRoundTripStable(markdown: string): boolean {
    if (hasFrontmatter(markdown)) return false;
    try {
        const parsed = markdownToBlocks(markdown);
        const written = blocksToMarkdown(parsed);
        // Byte-identical: nothing to argue about.
        if (written === markdown.trim()) return true;
        // Otherwise accept only a MEANING-PRESERVING normalisation — the same text, differing just
        // in how Markdown spells it (`\+` vs `+`, `_it_` vs `*it*`, a layout we can't reproduce).
        //
        // This compares against the ORIGINAL TEXT, not against a second parse. Comparing two parses
        // cannot work: information lost at the first parse is missing from both sides, so `#### h`
        // vs `### h` and `[!warning]` vs `[!note]` both looked identical — the two cases the guard
        // most needs to refuse.
        if (canonical(markdown) !== canonical(written)) return false;
        const reparsed = markdownToBlocks(written);
        // Belt and braces: the canonicalisation is textual, so a structural loss it cannot see has
        // to be caught here.
        if (!sameContent(parsed, reparsed)) return false;
        // …and one that SETTLES. Without this a note could be rewritten differently on every save,
        // which is how emphasis once compounded into literal asterisks over three saves.
        return blocksToMarkdown(reparsed) === written;
    } catch {
        // A parser crash is emphatically not a note we should be writing back.
        return false;
    }
}

/**
 * Strip exactly the spelling differences we are willing to let the serializer make. Everything else
 * — a heading level, a callout kind, a word, a URL — must survive verbatim.
 *
 * Applied to BOTH sides, so it can only ever equate two spellings of the same thing; it can never
 * hide a difference in one of them alone.
 */
function canonical(markdown: string): string {
    return (
        markdown
            // A redundant backslash escape: `\+` and `+` are the same character.
            .replace(/\\([!-/:-@[-`{-~])/g, '$1')
            // `_emphasis_` and `*emphasis*` are the same markup; we always write the asterisk form.
            .replace(/_/g, '*')
            // `*`, `+` and `-` are the same bullet; we always write the dash.
            .replace(/^[*+] /gm, '- ')
            // Table cell padding and trailing spaces are layout, not content.
            .replace(/[ \t]+/g, ' ')
            .replace(/^ | $/gm, '')
            // Inside a TABLE ROW, the spaces around the pipes and the length of a DELIMITER cell's
            // dash run are layout too — GFM reads `|-|`, `| --- |` and `| ------- |` identically,
            // and a cell whose text gained an escape widens its whole column, which changes every
            // separator in the table. Scoped to lines that are a table row so a dash run in prose
            // or inside a code fence is still compared verbatim, and to cells that are ONLY dashes
            // and colons so a run inside a cell's text still is.
            .replace(/^\|.*\|$/gm, (row) =>
                row
                    .replace(/ ?\| ?/g, '|')
                    .split('|')
                    .map((cell) => (/^:?-+:?$/.test(cell) ? cell.replace(/-+/, '---') : cell))
                    .join('|'),
            )
            // A run of blank lines means one blank line.
            .replace(/\n{2,}/g, '\n\n')
            .trim()
    );
}

/**
 * Do two parses carry the same content?
 *
 * Ids are minted per parse, and `blankBefore` / a table's `pad` and `widths` record how the TEXT was
 * laid out — the serializer reproduces them where it can, but a difference there is a reformat, not
 * a change of meaning, so it must not be what decides whether the note is safe. Everything else,
 * `html` above all, has to match exactly: that is where content loss would show up.
 */
function sameContent(left: Block[], right: Block[]): boolean {
    if (left.length !== right.length) return false;
    return left.every((block, index) => content(block) === content(right[index]));
}

function content(block: Block): string {
    const {id: _id, blankBefore: _blank, table, ...rest} = block;
    const layout = table ? {...table, pad: undefined, widths: undefined} : undefined;
    return JSON.stringify({...rest, table: layout});
}

/**
 * YAML frontmatter, which the block model has no block for.
 *
 * Checked SEPARATELY because byte-identity alone stopped catching it: the parser reads the `---`
 * fences as dividers and the keys as paragraphs, and once blocks began recording their own blank-line
 * spacing that mis-modelling started round-tripping byte-for-byte. The bytes survive, but the note is
 * shown as two horizontal rules around a paragraph and any structural edit near it writes that shape
 * back — so this is a case where a stable round trip is NOT the same as being able to hold the note.
 */
function hasFrontmatter(markdown: string): boolean {
    if (!markdown.startsWith('---\n')) return false;
    // A closing fence on its own line is what makes it frontmatter rather than a leading divider.
    return /\n---\s*(\n|$)/.test(markdown.slice(4));
}
