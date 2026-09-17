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

import {widestRow} from '../components/blockEditor/types';
import type {Block, BlockType, ColumnAlign, TableData} from '../components/blockEditor/types';

import {
    encodeLinkDestination,
    escapeMarkdownText,
    inlineHtmlToCodeText,
    inlineHtmlToMarkdown,
    longestRunOf,
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
    // No blank-line collapsing here: `blankBefore` already says exactly how many the source had,
    // and squashing runs of two undid that for every note with a deliberate double gap. Blocks the
    // editor created carry no count and get exactly one, so a run can only come from the file.
    return serializeRange(blocks, 0, blocks.length, 0).join('\n').trim();
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
            // A run that starts partway through — `5. 6. 7.` after some interrupting prose — keeps
            // its first number; CommonMark numbers the whole list from it.
            const running = ordinals.get(depth);
            ordinals.set(depth, running === undefined ? (block.listStart ?? 1) : running + 1);
        } else {
            ordinals.delete(depth);
        }
        // Leaving a depth ends any list that was running there.
        for (const level of [...ordinals.keys()]) if (level > depth) ordinals.delete(level);

        // `blankBefore` records what the source actually did, and a PARSED block always carries it —
        // so a tight list under a heading, a loose list, and a deliberate double gap all round-trip
        // as written. The list-to-list default applies only to blocks the editor itself created,
        // which carry no count.
        const gap =
            block.blankBefore ??
            (LIST_TYPES.has(previous?.type ?? 'text') && LIST_TYPES.has(block.type) ? 0 : 1);
        if (previous) for (let blank = 0; blank < gap; blank++) lines.push('');

        if (block.type === 'toggle') {
            const end = subtreeEnd(blocks, i + 1, block.depth ?? 0);
            // `for…of`, not `push(...lines)`: a table block serializes to one line per row, and
            // spreading those as ARGUMENTS blows the engine's limit on a big table (RangeError).
            for (const line of toggleLines(blocks, block, i, end, indent)) lines.push(line);
            previous = block;
            i = end - 1;
            continue;
        }

        for (const line of blockLines(block, indent, ordinals.get(depth) ?? 1)) lines.push(line);
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
            // The fence has to out-run the longest run of its OWN character in the body, whichever
            // character it is. Hard-coding `~~~` meant typing a `~~~` line into a tilde-fenced block
            // closed it early: the rest of the code escaped into the document as prose and the typed
            // line vanished.
            const char = block.fence === '~' ? '~' : '`';
            const fence = char.repeat(Math.max(3, longestRunOf(text, char) + 1));
            const open = fence + (block.language ?? '');
            // ONE chunk, so the blank-line collapse in `blocksToMarkdown` cannot reach inside it.
            return [[open, ...text.split('\n'), fence].map((line) => indent + line).join('\n')];
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
        case 'heading4':
            return prefixed(content, indent, '#### ');
        case 'heading5':
            return prefixed(content, indent, '##### ');
        case 'heading6':
            return prefixed(content, indent, '###### ');
        case 'quote':
            // A quote's own line breaks each need the marker, or they'd end the quote. A blank line
            // inside one gets a bare `>`: the parser reads lines after `trimEnd()`, so writing
            // `'> '` there means the file we save differs from the file we'd load back.
            return content.split('\n').map((line) => `${indent}>${line ? ` ${line}` : ''}`);
        case 'callout': {
            // `note` is the default for a callout the EDITOR created; one read from a file gives
            // back the kind and fold marker it came with.
            const marker = `[!${block.calloutKind ?? 'note'}]${block.calloutFold ?? ''}`;
            return content
                .split('\n')
                .map((line, at) =>
                    at === 0
                        ? `${indent}> ${marker}${line ? ` ${line}` : ''}`
                        : `${indent}>${line ? ` ${line}` : ''}`,
                );
        }
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
 * Anything that would open a DIFFERENT block if it began a line.
 *
 * A paragraph is written with no marker of its own, so a line inside one that happens to start with
 * `#`, `- `, `> ` or `---` was read back as a heading, a list item, a quote or a divider. It was
 * silent (the bytes matched, so the round-trip check saw nothing wrong) and the divider case LOST
 * the text outright, since a divider carries none. Soft-broken paragraphs hit it too: type `hello`,
 * shift+Enter, `- item`, and the second line became a list on the next load.
 *
 * One backslash is enough — the parser's block patterns are matched against the raw line, which no
 * longer starts with the marker, and the inline layer then unescapes any ASCII punctuation.
 *
 * Only markers that flip the block type UNCONDITIONALLY are listed here. `<details>` and a leading
 * `|` need a SECOND line to mean anything (a matching `</details>`, a separator row) and so are
 * handled by {@link escapeBlockStarts}, which can see the whole block: escaping them
 * unconditionally would put a backslash in the user's file to fix a problem that usually isn't
 * there, but a soft-broken paragraph supplies that second line itself — `| a | b |` ⇧↵
 * `| --- | --- |` came back as a TABLE, with the separator line consumed and gone.
 */
// `\s`, not a literal space: the PARSER's block patterns all use `\s+`, so `#\tfoo` is a heading to
// it. Matching only a space here wrote that line unescaped and it came back as a heading with the
// tab gone.
const BLOCK_START = /^(?:#{1,6}(?:\s|$)|[-*+](?:\s|$)|>|`{3,}|~{3,}|-{3,}$|_{3,}$|\*{3,}$)/;

/** An ordered-list marker, whose escapable character is the `.` or `)` — not the digits. */
const ORDERED_START = /^(\d+)[.)](?=\s|$)/;

/**
 * Escape a block's lines together, so the rules that need more than one line can see it.
 *
 * A `|` line only starts a table when the NEXT line is a separator row; a `<details>` only opens a
 * toggle when a later line closes it. Escaping either one unconditionally would churn ordinary
 * prose, so they are escaped exactly when the follow-on that gives them meaning is present.
 */
function escapeBlockStarts(lines: string[]): string[] {
    const closesToggle = lines.some((line) => /^<\/details>\s*$/i.test(line));
    return lines.map((line, at) => {
        if (/^\|/.test(line) && isSeparatorLine(lines[at + 1] ?? '')) return `\\${line}`;
        if (closesToggle && /^<\/?details[\s>]/i.test(line)) return `\\${line}`;
        return escapeBlockStart(line);
    });
}

/** The `| --- | :-: |` row that turns the line above it into a table header. */
function isSeparatorLine(line: string): boolean {
    return /^\|(?:\s*:?-+:?\s*\|)+$/.test(line.trim());
}

function escapeBlockStart(line: string): string {
    // Only ASCII PUNCTUATION can carry a backslash escape in CommonMark, so `\1.` is not an escape
    // at all — the backslash stays literal text and the next save escapes THAT, gaining one more
    // every time. The escape has to land on the marker's punctuation instead: `1\. item`, which the
    // parser's `\d+[.)]` no longer matches and the inline layer unescapes straight back.
    const ordered = ORDERED_START.exec(line);
    if (ordered) return `${ordered[1]}\\${line.slice(ordered[1].length)}`;
    return BLOCK_START.test(line) ? `\\${line}` : line;
}

/**
 * Lay a marker in front of a block's content. Continuation lines (a soft break inside the block)
 * are indented to the marker's width, which is what keeps them part of the same list item.
 */
function prefixed(content: string, indent: string, marker: string): string[] {
    const [first] = content.split('\n');
    const hanging = indent + ' '.repeat(marker.length);
    // An empty block writes its marker with no trailing space. The parser reads lines after
    // `trimEnd()`, so `'- '` reached it as `'-'` — which its `\s+`-requiring patterns rejected,
    // degrading an emptied-out list item into a paragraph containing a literal dash (and an empty
    // to-do into a bullet containing a literal `[ ]`). The parser accepts the bare marker instead.
    // Any line written WITHOUT a marker of its own has to be escaped, or it opens a different block
    // on the way back in — see `escapeBlockStart`. That is a paragraph's first line (it has no
    // marker at all) and every block's CONTINUATION lines: a to-do holding `line one` ⇧↵ `- line
    // two` came back as a to-do plus a nested bullet.
    // Escaped as a GROUP: the `|` and `<details>` rules need to see the neighbouring lines.
    const escaped = escapeBlockStarts(content.split('\n'));
    const [firstEscaped, ...restEscaped] = escaped;
    const body = marker === '' ? firstEscaped : first;
    const head = first === '' ? `${indent}${marker.trimEnd()}` : `${indent}${marker}${body}`;
    return [head, ...restEscaped.map((line) => (line ? `${hanging}${line}` : ''))];
}

/**
 * A resized image's ` =WxH` suffix — the YFM/diplodoc "imsize" spelling, which is what the app's
 * own preview understands and what other Markdown tools degrade to a plain image. Absent when the
 * image is at its natural size, so an untouched note never grows the suffix.
 */
function imageSize(block: Block): string {
    const {width, height} = block.image ?? {};
    // Explicitly against `undefined`, not falsiness: the parser accepts `=0x0` (only a wholly empty
    // `=x` is refused), so a falsy test would read that back and then drop the suffix on the way
    // out — a rewrite of markup the parser demonstrably understood.
    if (width === undefined && height === undefined) return '';
    return ` =${width ?? ''}x${height ?? ''}`;
}

/**
 * The separator cell for a column, carrying its alignment markers.
 *
 * `width` is the column's rendered width, or 0 when the table is written compact. The colons are
 * EXTRA, not carved out of the dashes — `:---` is the conventional compact spelling, so subtracting
 * them would emit `:--` and rewrite every aligned table it was meant to preserve.
 */
function separatorCell(align: ColumnAlign | null | undefined, width: number): string {
    const colons = align === 'center' ? 2 : align ? 1 : 0;
    const dashes = Math.max(width ? 1 : 3, width - colons);
    const rule = '-'.repeat(dashes);
    if (align === 'center') return `:${rule}:`;
    if (align === 'right') return `${rule}:`;
    if (align === 'left') return `:${rule}`;
    return rule;
}

/**
 * A table's Markdown lines, with no block indent. Exported for the PARSER: it decides whether the
 * source was written column-aligned by rendering the parsed table and comparing — asking the
 * serializer beats guessing from whitespace, and keeps the two halves honest by construction.
 */
export function renderTableLines(table: TableData): string[] {
    return tableLines({...EMPTY_TABLE_BLOCK, table}, '');
}

const EMPTY_TABLE_BLOCK: Block = {id: '', type: 'table', html: '', depth: 0};

function tableLines(block: Block, indent: string): string[] {
    const cells = block.table?.cells ?? [];
    if (cells.length === 0) return [];
    const columns = widestRow(cells);
    const align = block.table?.align ?? [];
    const text = (row: string[], column: number) =>
        inlineHtmlToMarkdown(row[column] ?? '')
            .replace(/\|/g, '\\|')
            .replace(/\n/g, ' ');

    // GFM has no headerless table, so a table whose first row is data gets an EMPTY header row —
    // which the parser reads back as `headerRow: false` rather than as a real row.
    const headerRow = block.table?.headerRow;
    const rows = headerRow ? cells : [Array.from({length: columns}, () => ''), ...cells];

    // 0 when the source was compact; otherwise the width it was written at, never narrower than
    // the content it has to hold (or than the separator's own three dashes).
    const written = block.table?.widths;
    const widths = Array.from({length: columns}, (_, column) =>
        written
            ? rows.reduce(
                  (max, row) => Math.max(max, text(row, column).length),
                  written[column] ?? 1,
              )
            : 0,
    );
    const gap = ' '.repeat(block.table?.pad ?? 1);
    const join = (cells: string[]) => `${indent}|${gap}${cells.join(`${gap}|${gap}`)}${gap}|`;
    const render = (row: string[]) =>
        join(
            Array.from({length: columns}, (_, column) => text(row, column).padEnd(widths[column])),
        );
    const separator = join(
        Array.from({length: columns}, (_, column) => separatorCell(align[column], widths[column])),
    );

    return [render(rows[0]), separator, ...rows.slice(1).map(render)];
}
