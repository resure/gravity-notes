/**
 * Block[] → Markdown. The write half of the on-disk format; `fromMarkdown` is its inverse.
 *
 * Notes are plain `.md` files, so the mapping favours what other Markdown tools understand:
 * headings, lists, task lists, block quotes, fenced code, GFM tables. The three block types with no
 * Markdown spelling get a portable encoding rather than a private one:
 *
 * - **toggle** → `<details>`/`<summary>` (GitHub and Obsidian render it, and the collapsed state
 *   survives as the presence of the `open` attribute);
 * - **callout** → an Obsidian `> [!note]` callout, which degrades to an ordinary block quote
 *   everywhere else;
 * - **image** → a normal `![alt](Attachments/…)` image.
 *
 * Deliberate losses, documented in ARCHITECTURE.md: block colors, and a table's header *column*
 * flag (GFM tables have no such concept).
 */

import type {Block, BlockType} from '../components/blockEditor/types';

import {
    encodeLinkDestination,
    escapeMarkdownText,
    inlineHtmlToCodeText,
    inlineHtmlToMarkdown,
} from './inline';

/** Blocks that render as list items — the only ones packed together without a blank line. */
const LIST_TYPES = new Set<BlockType>(['bulleted', 'numbered', 'todo']);

/** One indent level. Two spaces is the tightest nesting every Markdown parser agrees on. */
const INDENT = '  ';

/**
 * Serialization works in CHUNKS, not lines: a code block is one chunk that happens to contain
 * newlines, everything else is one chunk per line, and a blank separator is an empty chunk.
 *
 * That distinction is the whole point. The blank-line tidy-up below has to collapse the runs of
 * separators that nested `<details>` bodies produce, and it used to do that with a `\n{3,}` regex
 * over the finished document — which had no idea when it was inside a fence, so it silently deleted
 * blank lines from the user's source code (two blank lines between top-level Python defs became
 * one). Collapsing empty CHUNKS instead cannot reach inside a code block, because that block's
 * blank lines are interior to a single chunk rather than chunks of their own.
 */
export function blocksToMarkdown(blocks: Block[]): string {
    const chunks = serializeRange(blocks, 0, blocks.length, 0);
    const out: string[] = [];
    for (const chunk of chunks) {
        if (chunk === '' && out[out.length - 1] === '') continue;
        out.push(chunk);
    }
    return out.join('\n').trim();
}

/** Re-indent every line of a chunk, leaving its blank lines blank. */
function indentChunk(chunk: string, indent: string): string {
    if (!indent) return chunk;
    return chunk
        .split('\n')
        .map((line) => (line ? `${indent}${line}` : line))
        .join('\n');
}

/** The contiguous run of blocks after `start` that are nested deeper than `depth`. */
function subtreeEnd(blocks: Block[], start: number, depth: number): number {
    let end = start;
    while (end < blocks.length && (blocks[end].depth ?? 0) > depth) end++;
    return end;
}

/**
 * Serialize `blocks[from, to)`, rendering each block at `indentLevel` plus its own relative depth.
 * `indentLevel` is what lets a `<details>` body restart at zero indent while still nesting.
 */
function serializeRange(blocks: Block[], from: number, to: number, baseDepth: number): string[] {
    const lines: string[] = [];
    // Ordinals for numbered lists, per depth. Any other block at that depth resets its counter.
    const ordinals = new Map<number, number>();
    let previous: Block | null = null;

    for (let i = from; i < to; i++) {
        const block = blocks[i];
        const depth = Math.max(0, (block.depth ?? 0) - baseDepth);
        const indent = INDENT.repeat(depth);

        if (block.type === 'numbered') {
            ordinals.set(depth, (ordinals.get(depth) ?? 0) + 1);
        } else {
            ordinals.delete(depth);
        }
        // Leaving a depth ends any list that was running there.
        for (const level of [...ordinals.keys()]) if (level > depth) ordinals.delete(level);

        if (previous && !(LIST_TYPES.has(previous.type) && LIST_TYPES.has(block.type))) {
            lines.push('');
        }

        if (block.type === 'toggle') {
            const end = subtreeEnd(blocks, i + 1, block.depth ?? 0);
            lines.push(...toggleLines(blocks, block, i, end, indent));
            previous = block;
            i = end - 1;
            continue;
        }

        lines.push(...blockLines(block, indent, ordinals.get(depth) ?? 1));
        previous = block;
    }
    return lines;
}

/** A toggle plus its whole subtree, as a `<details>` element. */
function toggleLines(
    blocks: Block[],
    block: Block,
    index: number,
    end: number,
    indent: string,
): string[] {
    const summary = inlineHtmlToMarkdown(block.html).replace(/\n/g, ' ');
    // `collapsed` is the editor's state; `open` is the HTML one — they are opposites.
    const openAttr = block.collapsed ? '' : ' open';
    const lines = [`${indent}<details${openAttr}>`, `${indent}<summary>${summary}</summary>`, ''];
    // The body restarts at zero indent (the toggle's own indent is re-applied below), so `baseDepth`
    // here is the children's ABSOLUTE depth, not one relative to the enclosing range.
    const children = serializeRange(blocks, index + 1, end, (block.depth ?? 0) + 1);
    for (const chunk of children) lines.push(indentChunk(chunk, indent));
    lines.push('', `${indent}</details>`);
    return lines;
}

function blockLines(block: Block, indent: string, ordinal: number): string[] {
    const content = inlineHtmlToMarkdown(block.html);

    switch (block.type) {
        case 'divider':
            return [`${indent}---`];

        case 'code': {
            // Code is literal text: no inline Markdown, no escaping — just the fence. Read through
            // the line-preserving extractor: `Turn into ▸ Code` copies a paragraph's html verbatim,
            // so a `<br>` here is a real line break, and flattening it to a space (which the plain
            // text extractor does, correctly, for titles and previews) collapsed the snippet onto
            // one line and autosaved it that way.
            const text = inlineHtmlToCodeText(block.html);
            const fence = '`'.repeat(Math.max(3, longestBacktickRun(text) + 1));
            // ONE chunk, so the blank-line collapse in `blocksToMarkdown` cannot reach inside it.
            return [[fence, ...text.split('\n'), fence].map((line) => indent + line).join('\n')];
        }

        case 'table':
            return tableLines(block, indent);

        case 'image': {
            // Both halves need care. An `Attachments/…` ref containing a space has to keep its `<>`
            // wrapper or it stops parsing as an image AND breaks `attachmentRefsIn`, which then
            // reports the live file as an orphan and offers it for deletion in the Attachments
            // dialog. Alt text has to be escaped because a `]` in it (a file dropped as
            // `photo [1].png`) closes the label early and degrades the whole block to plain text.
            const src = encodeLinkDestination(block.image?.src ?? '');
            const alt = escapeMarkdownText(block.image?.alt ?? '');
            return [`${indent}![${alt}](${src}${imageSize(block)})`];
        }

        case 'heading1':
            return prefixed(content, indent, '# ');
        case 'heading2':
            return prefixed(content, indent, '## ');
        case 'heading3':
            return prefixed(content, indent, '### ');
        case 'quote':
            // A quote's own line breaks each need the marker, or they'd end the quote. A blank line
            // inside one gets a bare `>`: the parser reads lines after `trimEnd()`, so writing
            // `'> '` there means the file we save differs from the file we'd load back.
            return content.split('\n').map((line) => `${indent}>${line ? ` ${line}` : ''}`);
        case 'callout':
            return content
                .split('\n')
                .map((line, at) =>
                    at === 0
                        ? `${indent}> [!note]${line ? ` ${line}` : ''}`
                        : `${indent}>${line ? ` ${line}` : ''}`,
                );
        case 'bulleted':
            return prefixed(content, indent, '- ');
        case 'numbered':
            return prefixed(content, indent, `${ordinal}. `);
        case 'todo':
            return prefixed(content, indent, block.checked ? '- [x] ' : '- [ ] ');
        default:
            return prefixed(content, indent, '');
    }
}

/**
 * Lay a marker in front of a block's content. Continuation lines (a soft break inside the block)
 * are indented to the marker's width, which is what keeps them part of the same list item.
 */
function prefixed(content: string, indent: string, marker: string): string[] {
    const [first, ...rest] = content.split('\n');
    const hanging = indent + ' '.repeat(marker.length);
    // An empty block writes its marker with no trailing space. The parser reads lines after
    // `trimEnd()`, so `'- '` reached it as `'-'` — which its `\s+`-requiring patterns rejected,
    // degrading an emptied-out list item into a paragraph containing a literal dash (and an empty
    // to-do into a bullet containing a literal `[ ]`). The parser accepts the bare marker instead.
    const head = first === '' ? `${indent}${marker.trimEnd()}` : `${indent}${marker}${first}`;
    return [head, ...rest.map((line) => (line ? `${hanging}${line}` : ''))];
}

/**
 * A resized image's ` =WxH` suffix — the YFM/diplodoc "imsize" spelling, which is what the app's
 * own preview understands and what other Markdown tools degrade to a plain image. Absent when the
 * image is at its natural size, so an untouched note never grows the suffix.
 */
function imageSize(block: Block): string {
    const {width, height} = block.image ?? {};
    if (!width && !height) return '';
    return ` =${width ?? ''}x${height ?? ''}`;
}

function longestBacktickRun(text: string): number {
    let longest = 0;
    for (const run of text.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
    return longest;
}

function tableLines(block: Block, indent: string): string[] {
    const cells = block.table?.cells ?? [];
    if (cells.length === 0) return [];
    const columns = Math.max(...cells.map((row) => row.length));
    const render = (row: string[]) =>
        `${indent}| ${Array.from({length: columns}, (_, column) =>
            inlineHtmlToMarkdown(row[column] ?? '')
                .replace(/\|/g, '\\|')
                .replace(/\n/g, ' '),
        ).join(' | ')} |`;

    const separator = `${indent}| ${Array.from({length: columns}, () => '---').join(' | ')} |`;
    // GFM has no headerless table, so a table whose first row is data gets an EMPTY header row —
    // which the parser reads back as `headerRow: false` rather than as a real row.
    if (block.table?.headerRow) {
        return [render(cells[0]), separator, ...cells.slice(1).map(render)];
    }
    return [render(Array.from({length: columns}, () => '')), separator, ...cells.map(render)];
}
