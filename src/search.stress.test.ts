import {describe, expect, it} from 'vitest';

import {searchNotes} from './search';
import type {NoteMeta} from './storage/types';

/**
 * Stress / micro-benchmark for the full-text search hot path on a large folder. `useNoteSearch`
 * scores the whole corpus on every keystroke, so the cost that matters is per-keystroke work over
 * thousands of notes. This guards the precomputed-lowercase index (`searchNotes`'s `lowerById`):
 * the indexed path must never be slower than re-lowercasing every body on the fly, and a realistic
 * keystroke burst must stay well within budget. It also prints the before/after timing so the win
 * is visible when the suite runs.
 */

const NOTE_COUNT = 4000;
const WORDS_PER_NOTE = 220; // ≈ 1.5 KB of body per note → ≈ 6 MB corpus

// A fixed vocabulary so the corpus is deterministic (no Math.random) yet varied enough to rank.
const VOCAB = [
    'alpha',
    'beta',
    'gamma',
    'kubernetes',
    'docker',
    'roadmap',
    'meeting',
    'invoice',
    'design',
    'retro',
    'budget',
    'release',
    'sprint',
    'backlog',
    'incident',
    'postmortem',
    'objective',
    'hiring',
    'latency',
    'cache',
    'pipeline',
    'storage',
    'search',
    'editor',
];

function makeCorpus(count: number) {
    const notes: NoteMeta[] = [];
    const content = new Map<string, string>();
    const lower = new Map<string, string>();
    for (let i = 0; i < count; i++) {
        const id = `Folder${i % 50}/Note ${i}.md`;
        const words = Array.from(
            {length: WORDS_PER_NOTE},
            (_, j) => VOCAB[(i * 7 + j * 13) % VOCAB.length],
        );
        const body = words.join(' ');
        notes.push({id, title: `Note ${i} ${VOCAB[i % VOCAB.length]}`, updatedAt: count - i});
        content.set(id, body);
        lower.set(id, body.toLowerCase());
    }
    return {notes, content, lower};
}

describe('searchNotes — large-corpus stress', () => {
    const {notes, content, lower} = makeCorpus(NOTE_COUNT);
    // Type "kubernetes" one character at a time, the way the search box drives scoring.
    const keystrokes = ['k', 'ku', 'kub', 'kube', 'kuber', 'kubernetes'];

    function runBurst(useIndex: boolean): number {
        const start = performance.now();
        let lastCount = 0;
        for (const q of keystrokes) {
            lastCount = searchNotes(notes, content, q, useIndex ? lower : undefined).length;
        }
        expect(lastCount).toBeGreaterThan(0); // 'kubernetes' matches a large slice of the corpus
        return performance.now() - start;
    }

    it('returns identical results with and without the precomputed index', () => {
        const withIndex = searchNotes(notes, content, 'kubernetes docker', lower).map(
            (r) => r.note.id,
        );
        const without = searchNotes(notes, content, 'kubernetes docker').map((r) => r.note.id);
        expect(withIndex).toEqual(without);
    });

    it(`keeps a ${NOTE_COUNT}-note keystroke burst responsive (indexed never slower)`, () => {
        // On-the-fly first, so the indexed run can't be flattered by a cold JIT.
        const onTheFly = runBurst(false);
        const indexed = runBurst(true);
        // eslint-disable-next-line no-console
        console.log(
            `[stress] ${NOTE_COUNT} notes × ${keystrokes.length} keystrokes — ` +
                `on-the-fly ${onTheFly.toFixed(1)}ms vs indexed ${indexed.toFixed(1)}ms ` +
                `(${(onTheFly / Math.max(indexed, 0.01)).toFixed(2)}× faster)`,
        );
        // The index removes per-keystroke re-lowercasing, so it must not be slower; small slack for noise.
        expect(indexed).toBeLessThanOrEqual(onTheFly * 1.1 + 5);
        // And the whole burst must stay comfortably interactive even at this scale.
        expect(indexed).toBeLessThan(1500);
    });

    it(`caps the body-occurrence count so a term that repeats is scored in one short walk`, () => {
        // The scorer only uses min(count-1, BODY_FREQ_CAP), so it must stop counting past the cap.
        // Focused corpus: each note repeats the term many times. An UNcapped tally would walk every
        // occurrence; the capped walk stops at BODY_FREQ_CAP+1. This is the regression guard — it
        // fails loudly if the cap is removed (the uncapped pass balloons with REPEATS × N).
        const TERM = 'kubernetes';
        const REPEATS = 400;
        const N = 800;
        const body = `${TERM} `.repeat(REPEATS);
        const dense: NoteMeta[] = [];
        const denseContent = new Map<string, string>();
        const denseLower = new Map<string, string>();
        for (let i = 0; i < N; i++) {
            const id = `D/Note ${i}.md`;
            dense.push({id, title: `Note ${i}`, updatedAt: N - i});
            denseContent.set(id, body);
            denseLower.set(id, body);
        }

        // Reference: a deliberately UNcapped body-count pass over the same corpus (the work the cap
        // removes). Only the body walk differs from the real scorer.
        const tUncap = performance.now();
        for (const note of dense) {
            const b = denseLower.get(note.id) ?? body;
            let from = 0;
            for (;;) {
                const i = b.indexOf(TERM, from);
                if (i === -1) break;
                from = i + TERM.length;
            }
        }
        const uncappedMs = performance.now() - tUncap;

        const tCap = performance.now();
        const res = searchNotes(dense, denseContent, TERM, denseLower);
        const cappedMs = performance.now() - tCap;

        // eslint-disable-next-line no-console
        console.log(
            `[stress] repeat-term count — uncapped ${uncappedMs.toFixed(1)}ms vs capped ` +
                `${cappedMs.toFixed(1)}ms (${(uncappedMs / Math.max(cappedMs, 0.01)).toFixed(2)}× faster)`,
        );
        // Every note matches (the term is throughout each body); ranking correctness is covered by
        // search.test.ts — here we guard that the cap keeps the pass cheap despite N × REPEATS hits.
        expect(res).toHaveLength(N);
        expect(cappedMs).toBeLessThan(uncappedMs);
        // Absolute budget: an uncapped tally of N×REPEATS occurrences blows past this; the capped walk
        // (≈ BODY_FREQ_CAP+1 advances per note) stays well under it.
        expect(cappedMs).toBeLessThan(50);
    });
});
