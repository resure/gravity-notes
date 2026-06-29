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
});
