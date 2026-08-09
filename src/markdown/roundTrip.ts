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
    try {
        return blocksToMarkdown(markdownToBlocks(markdown)) === markdown.trim();
    } catch {
        // A parser crash is emphatically not a note we should be writing back.
        return false;
    }
}
