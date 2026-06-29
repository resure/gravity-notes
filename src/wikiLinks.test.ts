import {describe, expect, it} from 'vitest';

import type {NoteMeta} from './storage/types';
import {
    buildBacklinkInversion,
    buildBacklinks,
    extractWikiLinks,
    materializeBacklinks,
    resolveWikiLink,
    suggestWikiTargets,
} from './wikiLinks';

/** Build a NoteMeta list from ids (title derived from the leaf), with descending updatedAt. */
function notesFrom(ids: string[]): NoteMeta[] {
    return ids.map((id, i) => ({
        id,
        title: (id.split('/').pop() ?? id).replace(/\.md$/, ''),
        updatedAt: 1000 - i,
    }));
}

describe('extractWikiLinks', () => {
    it('finds each [[target]] with its position and trims the target', () => {
        const links = extractWikiLinks('see [[ Roadmap ]] and [[Ideas]].');
        expect(links.map((l) => l.target)).toEqual(['Roadmap', 'Ideas']);
        expect(links[0].index).toBe(4);
        expect('see [[ Roadmap ]]'.slice(links[0].index, links[0].index + links[0].length)).toBe(
            '[[ Roadmap ]]',
        );
    });

    it('skips empty / whitespace-only targets and never spans a newline', () => {
        expect(extractWikiLinks('[[]] and [[   ]]')).toEqual([]);
        expect(extractWikiLinks('[[a\nb]]')).toEqual([]);
    });

    it('does not match a malformed single-bracket or stray-bracket run', () => {
        expect(extractWikiLinks('[notes](x) and [[a]b]]')).toEqual([]);
    });
});

describe('resolveWikiLink', () => {
    it('matches by title, case-insensitively', () => {
        const notes = notesFrom(['Roadmap.md', 'Ideas.md']);
        expect(resolveWikiLink('roadmap', 'Ideas.md', notes)).toBe('Roadmap.md');
    });

    it('returns null when nothing matches', () => {
        expect(resolveWikiLink('Missing', 'Ideas.md', notesFrom(['Ideas.md']))).toBeNull();
    });

    it('ignores an |alias and a #heading anchor', () => {
        const notes = notesFrom(['Roadmap.md']);
        expect(resolveWikiLink('Roadmap|the plan', 'Ideas.md', notes)).toBe('Roadmap.md');
        expect(resolveWikiLink('Roadmap#Q3', 'Ideas.md', notes)).toBe('Roadmap.md');
        expect(resolveWikiLink('Roadmap#Q3|later', 'Ideas.md', notes)).toBe('Roadmap.md');
    });

    it('resolves an explicit Folder/Title path to that exact note', () => {
        const notes = notesFrom(['Roadmap.md', 'Work/Roadmap.md']);
        expect(resolveWikiLink('Work/Roadmap', 'Ideas.md', notes)).toBe('Work/Roadmap.md');
        expect(resolveWikiLink('Work/Roadmap.md', 'Ideas.md', notes)).toBe('Work/Roadmap.md');
    });

    it('prefers a same-folder note when a bare title is ambiguous', () => {
        const notes = notesFrom(['Notes.md', 'Work/Notes.md', 'Archive/Notes.md']);
        expect(resolveWikiLink('Notes', 'Work/Plan.md', notes)).toBe('Work/Notes.md');
        // From a root note, the shallowest (root) wins.
        expect(resolveWikiLink('Notes', 'Other.md', notes)).toBe('Notes.md');
    });

    it('breaks remaining ties on the shallowest path then the lexicographically-first id', () => {
        // Neither is in the linker's folder; the shallower (Inbox) beats Inbox/Sub, and between two
        // equally-deep candidates the lexicographic id wins.
        const notes = notesFrom(['Zeta/Notes.md', 'Alpha/Notes.md', 'Inbox/Sub/Notes.md']);
        expect(resolveWikiLink('Notes', 'Elsewhere/Plan.md', notes)).toBe('Alpha/Notes.md');
    });
});

describe('buildBacklinks', () => {
    const notes = notesFrom(['Roadmap.md', 'Ideas.md', 'Work/Plan.md', 'Standalone.md']);
    const corpus = new Map<string, string>([
        ['Roadmap.md', 'The roadmap. Links to itself [[Roadmap]] (ignored).'],
        ['Ideas.md', 'An idea that feeds the [[Roadmap]] nicely.'],
        ['Work/Plan.md', 'Plan references [[roadmap]] twice: [[Roadmap]].'],
        ['Standalone.md', 'No links here at all.'],
    ]);

    it('collects notes that link to the target, ignoring self-links', () => {
        const back = buildBacklinks('Roadmap.md', notes, corpus);
        expect(back.map((b) => b.note.id)).toEqual(['Ideas.md', 'Work/Plan.md']);
        expect(back.find((b) => b.note.id === 'Roadmap.md')).toBeUndefined();
    });

    it('captures a context snippet per link and counts multiple links in one note', () => {
        const back = buildBacklinks('Roadmap.md', notes, corpus);
        const plan = back.find((b) => b.note.id === 'Work/Plan.md');
        expect(plan?.contexts).toHaveLength(2);
        // The [[…]] is rendered as its bare title in the snippet (no brackets).
        expect(plan?.contexts[0]).toContain('roadmap');
        expect(plan?.contexts[0]).not.toContain('[[');
    });

    it('returns an empty list when nothing links to the target', () => {
        expect(buildBacklinks('Standalone.md', notes, corpus)).toEqual([]);
    });

    it('resolves ambiguous titles per the same-folder rule (map-based path matches resolveWikiLink)', () => {
        // Two notes share the title "Notes"; the linker sits in Work/, so its [[Notes]] must resolve
        // to Work/Notes.md (same folder), not the root one — exercising the precomputed title map.
        const dupes = notesFrom(['Notes.md', 'Work/Notes.md', 'Work/Plan.md']);
        const dupeCorpus = new Map<string, string>([
            ['Notes.md', ''],
            ['Work/Notes.md', ''],
            ['Work/Plan.md', 'Plan points at [[Notes]].'],
        ]);
        expect(buildBacklinks('Work/Notes.md', dupes, dupeCorpus).map((b) => b.note.id)).toEqual([
            'Work/Plan.md',
        ]);
        // The root Notes.md gets no backlink from Work/Plan.md (it lost the same-folder tiebreak).
        expect(buildBacklinks('Notes.md', dupes, dupeCorpus)).toEqual([]);
    });

    it('uses the precomputed links index when supplied (authoritative over the body)', () => {
        // A correct index yields the same result as on-the-fly extraction…
        const linksById = new Map([...corpus].map(([id, body]) => [id, extractWikiLinks(body)]));
        expect(
            buildBacklinks('Roadmap.md', notes, corpus, linksById).map((b) => b.note.id),
        ).toEqual(['Ideas.md', 'Work/Plan.md']);
        // …and an index that drops Ideas' links makes Ideas stop contributing a backlink — proving the
        // index, not the body, is what gets scanned (so the corpus never re-runs the link regex).
        const stale = new Map(linksById);
        stale.set('Ideas.md', []);
        expect(buildBacklinks('Roadmap.md', notes, corpus, stale).map((b) => b.note.id)).toEqual([
            'Work/Plan.md',
        ]);
    });

    it('materializeBacklinks sorts/displays by the LIVE note meta when supplied (stale inversion)', () => {
        // The inversion caches `note` refs; a prose-only edit bumps a linker's updatedAt without
        // rebuilding it. Passing the current meta must re-sort by the live updatedAt so the just-edited
        // source floats up — rather than ordering by the frozen pre-edit value.
        const inversion = buildBacklinkInversion(
            notes,
            new Map([...corpus].map(([id, body]) => [id, extractWikiLinks(body)])),
        );
        const bucket = inversion.get('Roadmap.md');
        // Default (cached) order: Ideas (999) before Work/Plan (998).
        expect(materializeBacklinks(bucket, corpus).map((b) => b.note.id)).toEqual([
            'Ideas.md',
            'Work/Plan.md',
        ]);
        // Live meta bumps Work/Plan above Ideas → the sort + displayed meta follow the fresh updatedAt.
        const fresh = new Map(
            notes.map((n) => [n.id, n.id === 'Work/Plan.md' ? {...n, updatedAt: 5000} : n]),
        );
        const sorted = materializeBacklinks(bucket, corpus, fresh);
        expect(sorted.map((b) => b.note.id)).toEqual(['Work/Plan.md', 'Ideas.md']);
        expect(sorted[0].note.updatedAt).toBe(5000); // shows the live meta, not the cached ref
    });
});

describe('suggestWikiTargets', () => {
    const notes = notesFrom(['Release notes.md', 'Releases.md', 'Pre-release.md', 'Ideas.md']);

    it('ranks exact, then prefix, then word-start, then substring matches', () => {
        const titles = suggestWikiTargets('rele', notes, 'X.md').map((n) => n.title);
        // "Releases" (prefix) and "Release notes" (prefix) outrank "Pre-release" (substring).
        expect(titles.slice(0, 2).sort()).toEqual(['Release notes', 'Releases']);
        expect(titles).toContain('Pre-release');
        expect(titles).not.toContain('Ideas');
    });

    it('never suggests the linking note itself', () => {
        expect(suggestWikiTargets('rele', notes, 'Releases.md').map((n) => n.id)).not.toContain(
            'Releases.md',
        );
    });

    it('lists notes (most-recent first) for an empty query, and respects the limit', () => {
        const all = suggestWikiTargets('', notes, 'X.md');
        expect(all).toHaveLength(4);
        expect(suggestWikiTargets('', notes, 'X.md', 2)).toHaveLength(2);
    });
});
