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

import type {Block, BlockType, TableData} from '../components/blockEditor/types';
import {newBlock, uid} from '../components/blockEditor/types';

import {inlineMarkdownToHtml} from './inline';

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
        // Clamp to one level deeper than what precedes it, so a four-space-indented foreign file
        // nests one level rather than two.
        const raw = baseDepth + Math.floor(indent / SPACES_PER_LEVEL);
        return Math.max(baseDepth, Math.min(raw, maxDepth + 1));
    };
    // Returns the new open block rather than assigning it, so `open`'s narrowing stays visible to
    // the compiler (an assignment inside a closure is invisible to control-flow analysis).
    const push = (block: Block, contentIndent: number): OpenBlock => {
        blocks.push(block);
        maxDepth = block.depth ?? baseDepth;
        return {block, contentIndent};
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.blank) {
            open = null;
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
            const children = parseLines(inner.slice(summaryAt + 1), depth + 1);
            blocks.push(...children);
            maxDepth = Math.max(maxDepth, ...children.map((child) => child.depth ?? 0));
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
        const image = /^!\[([^\]]*)\]\(\s*(?:<([^>]*)>|(\S+?))\s*\)$/.exec(line.text);
        if (image) {
            const block = newBlock('image');
            block.depth = depth;
            block.image = {src: image[2] ?? image[3] ?? '', alt: image[1] || undefined};
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
            const callout = /^\[!([a-zA-Z]+)\][-+]?\s*/.exec(body[0] ?? '');
            if (callout) body[0] = body[0].slice(callout[0].length);
            const block = newBlock(
                callout ? 'callout' : 'quote',
                inlineMarkdownToHtml(body.join('\n')),
            );
            block.depth = depth;
            push(block, line.indent);
            open = null;
            i = end - 1;
            continue;
        }

        // ---- heading -----------------------------------------------------------------------
        const heading = /^(#{1,6})(?:\s+(.*))?$/.exec(line.text);
        if (heading) {
            const level = Math.min(3, heading[1].length) as 1 | 2 | 3;
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

function isSeparatorRow(text: string): boolean {
    return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(text.trim());
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

function parseTable(rows: string[]): TableData {
    const header = splitRow(rows[0]);
    const body = rows.slice(2).map(splitRow);
    const columns = Math.max(header.length, ...body.map((row) => row.length), 1);
    const pad = (row: string[]) =>
        Array.from({length: columns}, (_, column) => inlineMarkdownToHtml(row[column] ?? ''));
    // An all-empty header row is how a headerless table is written (GFM demands *some* header).
    const headerRow = header.some((cell) => cell !== '');
    const cells = headerRow ? [pad(header), ...body.map(pad)] : body.map(pad);
    return {
        cells: cells.length > 0 ? cells : [Array.from({length: columns}, () => '')],
        headerRow,
    };
}

/** Code-block text is stored as escaped HTML, like every other block's content. */
function escapeText(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A fresh, empty document — what an empty note opens with. */
export function emptyDocument(): Block[] {
    return [{id: uid(), type: 'text', html: '', depth: 0}];
}
