import {describe, expect, it} from 'vitest';

import type {Block, BlockColor, BlockType} from '../components/blockEditor/types';

import {markdownToBlocks} from './fromMarkdown';
import {isRoundTripStable} from './roundTrip';
import {blocksToMarkdown} from './toMarkdown';

/**
 * Property tests for the seam the whole block surface rests on.
 *
 * The vault corpus proves the seam handles the notes that exist; this proves the two invariants
 * hold for documents nobody has written yet. Both are data-integrity properties: the block engine
 * re-serializes the WHOLE note on every keystroke, so an asymmetry here rewrites a real file.
 *
 * Seeded so a failure is reproducible — the seed is printed in the assertion message.
 *
 * 20k seeds runs in well under two seconds; it has been run at 50k while developing. Raise the
 * range when touching the seam — that is how the toggle-indent bug below was found.
 */
function rng(seed: number): () => number {
    // A small LCG rather than xorshift: the same job (deterministic, well-spread), without the
    // bitwise operators the project's lint config forbids.
    let state = seed;
    return () => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state / 2147483648;
    };
}

const INLINE = [
    'plain words',
    '<strong>bold</strong>',
    '<em>it</em>',
    '<code>a * b</code>',
    '<s>gone</s>',
    'a &amp; b &lt;c&gt;',
    '[[Wiki Link]]',
    '<a href="https://x.dev" rel="noopener noreferrer">site</a>',
    '<a href="https://x.dev" title="T" rel="noopener noreferrer">titled</a>',
    'trailing punctuation!',
    '2 * 3 = 6',
    'snake_case_name',
    'a ~ b',
    'C:\\path\\here',
    '# not a heading',
    '- not a list',
    '&gt; not a quote',
    '---',
    '1. not numbered',
    'line one<br>- line two',
    '`x` and ``y``',
    // Shapes a review pass found the seam mishandling: a marker followed by a TAB, the two block
    // starts that need a second line, and a fence character inside its own fence.
    '#\ttabbed',
    '1.\ttabbed',
    '| a | b |<br>| --- | --- |',
    '&lt;details&gt;<br>&lt;summary&gt;s&lt;/summary&gt;<br>&lt;/details&gt;',
    'code<br>~~~<br>more',
    '&gt; [!my-note] custom callout',
    // Colours: an inline one, one wrapping a whole line (which the reader lifts to a block colour),
    // a nested pair, and the shapes that must NOT be read as colour at all.
    'a <span class="gn-color gn-color--red">red</span> word',
    '<span class="gn-color gn-color--blue_background">whole line</span>',
    '<span class="gn-color gn-color--red">outer <span class="gn-color gn-color--green">inner</span></span>',
    'literal {foo}(bar)',
    '{red}(already text)',
    'unbalanced <span class="gn-color gn-color--red">smile :)</span>',
];

const COLORS: BlockColor[] = ['red', 'yellow_background', 'gray'];

const TYPES: BlockType[] = [
    'text',
    'heading1',
    'heading3',
    'heading6',
    'todo',
    'bulleted',
    'numbered',
    'toggle',
    'quote',
    'callout',
    'divider',
    'code',
    'table',
];

function makeBlocks(next: () => number, count: number): Block[] {
    const blocks: Block[] = [];
    let previousDepth = 0;
    for (let i = 0; i < count; i++) {
        const type = TYPES[Math.floor(next() * TYPES.length)];
        const html = INLINE[Math.floor(next() * INLINE.length)];
        // The editor's own depth rules, so the generator explores documents it can actually
        // produce: at most one level deeper than the block above (`changeBlockDepth` clamps to
        // `previousDepth + 1`), and the FIRST block never indented (it returns unchanged for
        // index 0, having nothing to nest under). Generating outside that tests the parser's
        // clamps rather than the seam — those are documented one-time normalisations that settle
        // on the next save instead of compounding.
        const depth = i === 0 ? 0 : Math.min(Math.floor(next() * 3), previousDepth + 1);
        previousDepth = depth;
        const block: Block = {id: `b${i}`, type, html, depth};
        if (type === 'divider' || type === 'table') block.html = '';
        if (type === 'todo') block.checked = next() > 0.5;
        if (type === 'toggle') block.collapsed = next() > 0.5;
        if (type === 'code') block.html = 'const a = 1;<br>const b = 2;';
        if (type === 'callout' && next() > 0.5) block.calloutKind = 'warning';
        // A block colour on a quarter of the blocks, including the types that cannot keep one —
        // dropping it there is exactly the asymmetry this test exists to catch.
        if (next() > 0.75) block.color = COLORS[Math.floor(next() * COLORS.length)];
        if (type === 'table') {
            block.table = {
                cells: [
                    ['a', 'bb'],
                    ['c', 'd'],
                ],
                headerRow: true,
            };
        }
        blocks.push(block);
    }
    return blocks;
}

describe('round-trip properties', () => {
    it('blocks → Markdown → blocks → Markdown is a fixed point', () => {
        for (let seed = 1; seed <= 20000; seed++) {
            const next = rng(seed);
            const blocks = makeBlocks(next, 1 + Math.floor(next() * 8));
            // A file ENTERS the editor by being parsed, so that is where the invariant starts: from
            // a parsed document, serializing must be a fixed point. Between hand-built blocks and
            // their first parse the model may normalise once — it is deliberately smaller than
            // Markdown in places (a depth the indentation cannot express relative to its
            // predecessor, a toggle body's nesting) — and that is safe precisely because it
            // SETTLES. What would not be safe is drift: a note rewritten differently on every
            // save, which is how emphasis once compounded into literal asterisks.
            const once = blocksToMarkdown(markdownToBlocks(blocksToMarkdown(blocks)));
            const twice = blocksToMarkdown(markdownToBlocks(once));
            expect(twice, `seed ${seed}\n--- once ---\n${once}\n--- twice ---\n${twice}`).toBe(
                once,
            );
        }
    });

    it('never calls a note stable unless editing it leaves the file alone', () => {
        for (let seed = 1; seed <= 20000; seed++) {
            const next = rng(seed);
            const markdown = blocksToMarkdown(makeBlocks(next, 1 + Math.floor(next() * 8)));
            if (!isRoundTripStable(markdown)) continue;
            // The guard's whole promise: a note it admits to the block surface is one the surface
            // can write back without changing anything the user did not edit.
            const written = blocksToMarkdown(markdownToBlocks(markdown));
            expect(
                blocksToMarkdown(markdownToBlocks(written)),
                `seed ${seed}\n--- markdown ---\n${markdown}`,
            ).toBe(written);
        }
    });
});
