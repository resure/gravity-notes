/**
 * Markdown → Block[]. The read half of the on-disk format; `toMarkdown` is its inverse.
 *
 * This is a deliberately small, line-oriented parser rather than a CommonMark implementation: it
 * has to recognise exactly what `toMarkdown` writes (so a note round-trips byte-for-byte) and
 * degrade sensibly on everything else a hand-written or Obsidian-authored file might contain.
 *
 * Known gaps vs. full CommonMark, all of which land as plain paragraphs: setext headings,
 * indented (non-fenced) code blocks, reference links, and HTML blocks other than `<details>`.
 */

import type {Block, BlockType, ColumnAlign, TableData} from '../components/blockEditor/types';
import {newBlock, uid, widestRow} from '../components/blockEditor/types';

import {liftBlockColor} from './color';
import {inlineMarkdownToHtml} from './inline';
import {renderTableLines} from './toMarkdown';

/** Nesting is written two spaces per level; four-space files are normalised by the depth clamp. */
const SPACES_PER_LEVEL = 2;

interface Line {
    indent: number;
    /** The exact leading-whitespace RUN, not just its width — a tab is one column but not one space. */
    lead: string;
    text: string;
    /** `text` with trailing whitespace intact, for code blocks (where it is content). */
    rawText: string;
    blank: boolean;
}

/** The block still accepting continuation lines, with the column its content starts at. */
interface OpenBlock {
    block: Block;
    contentIndent: number;
}

function scanLines(markdown: string): Line[] {
    return markdown
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((raw) => {
            const text = raw.replace(/^\s+/, '');
            return {
                indent: raw.length - text.length,
                lead: raw.slice(0, raw.length - text.length),
                text: text.trimEnd(),
                rawText: text,
                blank: text.trim() === '',
            };
        });
}

export function markdownToBlocks(markdown: string): Block[] {
    const blocks = parseLines(scanLines(markdown), 0);
    return blocks.length > 0 ? blocks : [newBlock('text')];
}

/**
 * Parse a run of lines into blocks at `baseDepth`.
 *
 * `previous` tracking is what distinguishes a *continuation* line (no blank line since the last
 * block — a soft break inside it) from a new indented block (blank line first), which is the same
 * distinction CommonMark draws.
 */
function parseLines(lines: Line[], baseDepth: number): Block[] {
    const blocks: Block[] = [];
    // Null after a blank line, which is what ends a block's run of continuation lines.
    let open: OpenBlock | null = null;
    let maxDepth = baseDepth;

    const depthOf = (indent: number) => {
        // The FIRST block of a range sits at the base depth whatever its indent: it has nothing to
        // nest under, the editor refuses to indent it (`changeBlockDepth` returns unchanged for
        // index 0), and `blocksToMarkdown` trims the document's leading whitespace anyway — so
        // reading an indent here produced a depth that could never be written back, and the
        // document could not settle.
        if (blocks.length === 0) return baseDepth;
        // Clamp to one level deeper than what precedes it, so a four-space-indented foreign file
        // nests one level rather than two.
        const raw = baseDepth + Math.floor(indent / SPACES_PER_LEVEL);
        return Math.max(baseDepth, Math.min(raw, maxDepth + 1));
    };
    // Returns the new open block rather than assigning it, so `open`'s narrowing stays visible to
    // the compiler (an assignment inside a closure is invisible to control-flow analysis).
    // Blank lines seen since the last block was pushed. The FIRST block has no predecessor, so its
    // leading blanks are the document's own and are dropped by the trim.
    let blanksSincePush = 0;
    const push = (block: Block, contentIndent: number): OpenBlock => {
        if (blocks.length > 0) block.blankBefore = blanksSincePush;
        blanksSincePush = 0;
        blocks.push(block);
        maxDepth = block.depth ?? baseDepth;
        return {block, contentIndent};
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.blank) {
            open = null;
            blanksSincePush += 1;
            continue;
        }
        const depth = depthOf(line.indent);

        // ---- fenced code -------------------------------------------------------------------
        const fence = /^(`{3,}|~{3,})(.*)$/.exec(line.text);
        if (fence) {
            const body: string[] = [];
            let j = i + 1;
            for (; j < lines.length; j++) {
                const raw = lines[j];
                if (!raw.blank && raw.text.startsWith(fence[1])) break;
                // Re-indent relative to the fence by stripping its exact leading run, not by
                // counting columns: measuring the indent in characters turned every tab into a
                // single space, which silently reformatted tab-indented code (and stopped a pasted
                // Makefile recipe from being a valid recipe). Trailing whitespace is content here
                // too, so this reads `rawText` rather than the trimmed `text`.
                body.push(raw.blank ? '' : dedent(raw.lead, line.lead) + raw.rawText);
            }
            const block = newBlock('code', escapeText(body.join('\n')));
            const info = fence[2].trim();
            if (info) block.language = info;
            if (fence[1][0] === '~') block.fence = '~';
            block.depth = depth;
            push(block, line.indent);
            open = null;
            i = j;
            continue;
        }

        // ---- <details> toggle --------------------------------------------------------------
        const details = /^<details(\s+open)?\s*>$/i.exec(line.text);
        const detailsEnd = details ? findDetailsEnd(lines, i) : -1;
        if (details && detailsEnd !== -1) {
            const end = detailsEnd;
            const inner = lines.slice(i + 1, end);
            const summaryAt = inner.findIndex((candidate) => /<summary>/i.test(candidate.text));
            const summary =
                summaryAt === -1
                    ? ''
                    : (/<summary>([\s\S]*?)<\/summary>/i.exec(inner[summaryAt].text)?.[1] ?? '');
            const block = newBlock('toggle', inlineMarkdownToHtml(summary.trim()));
            block.depth = depth;
            block.collapsed = !details[1];
            push(block, line.indent);
            open = null;
            // DEDENT the body by the toggle's own indent before reading it. The writer emits a
            // toggle's children at a depth RELATIVE to the toggle and then indents the whole block
            // to the toggle's column (`toggleLines` → `indentChunk`); reading that column as part
            // of the child's depth counted it twice, so a nested toggle's children drifted one
            // level deeper on every save. It settled, but only after rewriting the file.
            const rawBody = inner.slice(summaryAt + 1);
            // Dedent by what the body ACTUALLY shares, never by more. Clamping each line at 0
            // instead flattened a body indented LESS than its toggle onto column 0, which moved the
            // `<details>` line but not the `<summary>` and left the document unable to settle.
            const shared = rawBody.reduce(
                (least, child) => (child.blank ? least : Math.min(least, child.indent)),
                line.indent,
            );
            const body = rawBody.map((child) =>
                child.blank ? child : {...child, indent: child.indent - shared},
            );
            const children = parseLines(body, depth + 1);
            // `for…of` and `reduce`, not spreads: a large toggle body passes one argument per
            // block and throws a RangeError (the same limit `toMarkdown` documents avoiding).
            for (const child of children) blocks.push(child);
            maxDepth = children.reduce((max, child) => Math.max(max, child.depth ?? 0), maxDepth);
            i = end;
            continue;
        }

        // ---- table -------------------------------------------------------------------------
        if (line.text.startsWith('|') && isSeparatorRow(lines[i + 1]?.text ?? '')) {
            let end = i + 2;
            while (end < lines.length && !lines[end].blank && lines[end].text.startsWith('|'))
                end++;
            const block = newBlock('table');
            block.depth = depth;
            block.table = parseTable(lines.slice(i, end).map((row) => row.text));
            push(block, line.indent);
            open = null;
            i = end - 1;
            continue;
        }

        // ---- divider -----------------------------------------------------------------------
        if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.text)) {
            const block = newBlock('divider');
            block.depth = depth;
            push(block, line.indent);
            open = null;
            continue;
        }

        // ---- standalone image --------------------------------------------------------------
        // The optional ` =WxH` tail is the YFM "imsize" suffix a resized image carries; either half
        // may be blank (` =600x` is the common form the editor writes after a drag-resize).
        const image = /^!\[([^\]]*)\]\(\s*(?:<([^>]*)>|(\S+?))(?:\s+=(\d*)x(\d*))?\s*\)$/.exec(
            line.text,
        );
        // A degenerate ` =x` carries no size, so accepting it would drop the suffix on the way back
        // out — i.e. rewrite the line. Refuse the match instead: the note then fails the round-trip
        // guard and opens as source, which is the correct outcome for markup we can't reproduce.
        if (image && !(image[4] === '' && image[5] === '')) {
            const block = newBlock('image');
            block.depth = depth;
            block.image = {
                src: image[2] ?? image[3] ?? '',
                alt: image[1] || undefined,
                width: image[4] ? Number(image[4]) : undefined,
                height: image[5] ? Number(image[5]) : undefined,
            };
            push(block, line.indent);
            open = null;
            continue;
        }

        // ---- block quote / callout ---------------------------------------------------------
        if (line.text.startsWith('>')) {
            let end = i;
            const body: string[] = [];
            while (end < lines.length && lines[end].text.startsWith('>')) {
                body.push(lines[end].text.replace(/^>\s?/, ''));
                end++;
            }
            // Obsidian's custom callouts allow digits and hyphens. `[a-zA-Z]+` alone degraded
            // `> [!my-note]` to a plain quote — and then the marker got backslash-escaped, so the
            // file gained `\[!my-note\]` and the callout was gone in Obsidian too.
            const callout = /^\[!([\w-]+)\]([-+]?)\s*/.exec(body[0] ?? '');
            if (callout) body[0] = body[0].slice(callout[0].length);
            const block = newBlock(
                callout ? 'callout' : 'quote',
                inlineMarkdownToHtml(body.join('\n')),
            );
            if (callout) {
                block.calloutKind = callout[1];
                if (callout[2]) block.calloutFold = callout[2] as '-' | '+';
            }
            block.depth = depth;
            push(block, line.indent);
            open = null;
            i = end - 1;
            continue;
        }

        // ---- heading -----------------------------------------------------------------------
        const heading = /^(#{1,6})(?:\s+(.*))?$/.exec(line.text);
        if (heading) {
            const level = heading[1].length as 1 | 2 | 3 | 4 | 5 | 6;
            const block = newBlock(
                `heading${level}` as BlockType,
                inlineMarkdownToHtml(heading[2] ?? ''),
            );
            block.depth = depth;
            open = push(block, line.indent + heading[1].length + 1);
            continue;
        }

        // ---- list items --------------------------------------------------------------------
        const item = /^([-*+]|\d+[.)])(?:\s+(.*))?$/.exec(line.text);
        if (item) {
            const rest = item[2] ?? '';
            const todo = /^\[( |x|X)\](?:\s+(.*))?$/.exec(rest);
            const type: BlockType = todo ? 'todo' : /^\d/.test(item[1]) ? 'numbered' : 'bulleted';
            const block = newBlock(type, inlineMarkdownToHtml((todo ? todo[2] : rest) ?? ''));
            block.depth = depth;
            if (todo) block.checked = todo[1].toLowerCase() === 'x';
            if (type === 'numbered') {
                // Only on the first item of a run — the rest simply count on from it.
                const above = blocks[blocks.length - 1];
                const continues = above?.type === 'numbered' && (above.depth ?? 0) === depth;
                if (!continues) block.listStart = Number.parseInt(item[1], 10);
            }
            open = push(block, line.indent + item[1].length + 1 + (todo ? 4 : 0));
            continue;
        }

        // ---- paragraph, or a continuation of the block above --------------------------------
        if (open && line.indent >= open.contentIndent && isEditableBlock(open.block)) {
            open.block.html += `<br>${inlineMarkdownToHtml(line.text)}`;
            continue;
        }
        const block = newBlock('text', inlineMarkdownToHtml(line.text));
        block.depth = depth;
        open = push(block, line.indent);
    }

    // After the walk, not during it: a paragraph the file wrapped across several lines is only whole
    // once the last continuation has been appended, and a colour covering it can only be recognised
    // then.
    for (const block of blocks) {
        if (block.type === 'code') continue;
        const lifted = liftBlockColor(block.html);
        if (lifted) {
            block.html = lifted.html;
            block.color = lifted.color;
        }
    }

    return blocks;
}

function isEditableBlock(block: Block): boolean {
    return block.type !== 'divider' && block.type !== 'table' && block.type !== 'image';
}

/**
 * Index of the `</details>` closing the one opened at `start`, or -1 when there is none.
 *
 * Reporting the last line for an unclosed tag DELETED content: the caller slices the body as
 * `lines.slice(start + 1, end)` and resumes at `end`, so the final line fell into neither the toggle
 * nor the document. A note that merely mentions `<details>` on its own line — an HTML snippet, a
 * pasted README — lost its last paragraph. With -1 the caller declines the toggle and lets the line
 * degrade to a paragraph, which keeps every byte.
 */
function findDetailsEnd(lines: Line[], start: number): number {
    let depth = 0;
    for (let i = start; i < lines.length; i++) {
        if (/^<details(\s|>)/i.test(lines[i].text)) depth++;
        if (/^<\/details>$/i.test(lines[i].text)) {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/** Strip the enclosing fence's leading-whitespace run from a body line's own run. */
function dedent(lead: string, fenceLead: string): string {
    return lead.startsWith(fenceLead) ? lead.slice(fenceLead.length) : lead;
}

const PIPED_SEPARATOR = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;
const BARE_SEPARATOR = /^:?-{2,}:?$/;

/**
 * A GFM delimiter row. ONE dash is enough where the row has pipes — `|-|-|` is legal GFM and common
 * in hand-written notes, and demanding two meant such a table opened as paragraphs and then had a
 * backslash written into the user's file (the serializer's own check, which decides what to escape,
 * accepts a single dash). Without pipes two are still required: a lone `-` on a line is an empty
 * list item, not a table.
 */
function isSeparatorRow(text: string): boolean {
    const trimmed = text.trim();
    return trimmed.includes('|') ? PIPED_SEPARATOR.test(trimmed) : BARE_SEPARATOR.test(trimmed);
}

/** Split one `| a | b |` row, honouring `\|` escapes. */
function splitRow(row: string): string[] {
    const trimmed = row.trim().replace(/^\|/, '').replace(/\|$/, '');
    const cells: string[] = [];
    let current = '';
    for (let i = 0; i < trimmed.length; i++) {
        if (trimmed[i] === '\\' && trimmed[i + 1] === '|') {
            current += '|';
            i++;
            continue;
        }
        if (trimmed[i] === '|') {
            cells.push(current.trim());
            current = '';
            continue;
        }
        current += trimmed[i];
    }
    cells.push(current.trim());
    return cells;
}

/**
 * The per-column widths a table was WRITTEN at, or null when its rows disagree (so it was never
 * column-aligned to begin with). Measured on the raw text between the pipes, minus the one space
 * of padding either side that the aligned style always carries.
 */
function writtenLayout(rows: string[]): {widths?: number[]; pad: number} | null {
    let pad: number | null = null;
    let widths: number[] | null = null;
    let aligned = true;
    for (const row of rows) {
        const body = row.trim().replace(/^\|/, '').replace(/\|$/, '');
        const cells = body.split('|');
        // `| a | b |` pads every cell by one space; `|a|b|` pads none. A table that mixes the two
        // is hand-irregular — no layout to reproduce, so it round-trips in the default style.
        const rowPad = cells.every((cell) => /^ .* $/.test(cell))
            ? 1
            : cells.every((cell) => !/^ | $/.test(cell))
              ? 0
              : null;
        if (rowPad === null) return null;
        if (pad === null) pad = rowPad;
        else if (pad !== rowPad) return null;
        // Widths are a SEPARATE question from padding: only a column-aligned table writes every row
        // at the same widths. An ordinary `| a | b |` table does not, and requiring it to ruled out
        // the very style it was meant to preserve.
        const measured = cells.map((cell) => cell.length - 2 * rowPad);
        if (!widths) widths = measured;
        else if (widths.length !== measured.length || widths.some((w, i) => w !== measured[i]))
            aligned = false;
    }
    if (pad === null) return null;
    return aligned && widths ? {widths, pad} : {pad};
}

/** `:---` / `:--:` / `---:` in the separator row; anything else is the default (no marker). */
function columnAlign(cell: string): ColumnAlign | null {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return null;
}

function parseTable(rows: string[]): TableData {
    const header = splitRow(rows[0]);
    const body = rows.slice(2).map(splitRow);
    const columns = Math.max(header.length, widestRow(body), 1);
    const pad = (row: string[]) =>
        Array.from({length: columns}, (_, column) => inlineMarkdownToHtml(row[column] ?? ''));
    // An all-empty header row is how a headerless table is written (GFM demands *some* header).
    const headerRow = header.some((cell) => cell !== '');
    const cells = headerRow ? [pad(header), ...body.map(pad)] : body.map(pad);
    const align = splitRow(rows[1]).map(columnAlign);
    const table: TableData = {
        cells: cells.length > 0 ? cells : [Array.from({length: columns}, () => '')],
        headerRow,
        // Only carry the array when something is actually marked, so the common table stays clean.
        ...(align.some(Boolean) ? {align} : {}),
    };
    // Column-aligned style? Every row has to be written at the SAME widths for that to be true;
    // anything else is hand-irregular and round-trips compact. Verified against the serializer at
    // the end, so the flag can never claim a rendering it doesn't actually produce.
    const layout = writtenLayout(rows);
    if (layout) {
        if (layout.widths) table.widths = layout.widths;
        table.pad = layout.pad;
        if (renderTableLines(table).join('\n') !== rows.join('\n')) {
            delete table.widths;
            delete table.pad;
        }
    }
    return table;
}

/** Code-block text is stored as escaped HTML, like every other block's content. */
function escapeText(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A fresh, empty document — what an empty note opens with. */
export function emptyDocument(): Block[] {
    return [{id: uid(), type: 'text', html: '', depth: 0}];
}
