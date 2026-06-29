import {describe, expect, it} from 'vitest';

import {buildSnippet, escapeRegExp, scoreNoteText, searchNotes, tokenizeQuery} from './search';
import type {NoteMeta} from './storage/types';

describe('tokenizeQuery', () => {
    it('lowercases and splits on whitespace, dropping empties', () => {
        expect(tokenizeQuery('  Release   NOTES ')).toEqual(['release', 'notes']);
    });

    it('returns an empty array for a blank query', () => {
        expect(tokenizeQuery('   ')).toEqual([]);
    });
});

describe('escapeRegExp', () => {
    it('escapes regex metacharacters so terms match literally', () => {
        expect(escapeRegExp('a.b*c')).toBe('a\\.b\\*c');
    });
});

describe('scoreNoteText', () => {
    const score = (title: string, body: string, query: string): number | null => {
        const terms = tokenizeQuery(query);
        const r = scoreNoteText(
            title.toLowerCase(),
            body.toLowerCase(),
            terms,
            terms.join(' '),
            terms.length > 1,
        );
        return r ? r.score : null;
    };

    it('returns null when any term is absent from both title and body (AND)', () => {
        expect(score('Alpha', 'some body', 'alpha missing')).toBeNull();
    });

    it('reports bodyMatched only when a term hit the body (gates snippet building)', () => {
        const terms = tokenizeQuery('alpha');
        const titleOnly = scoreNoteText('alpha', 'unrelated body', terms, 'alpha', false);
        const bodyHit = scoreNoteText('untitled', 'about alpha here', terms, 'alpha', false);
        expect(titleOnly?.bodyMatched).toBe(false);
        expect(bodyHit?.bodyMatched).toBe(true);
    });

    it('ranks a title hit above a body-only hit', () => {
        const titleHit = score('Release notes', 'unrelated', 'release');
        const bodyHit = score('Unrelated', 'the release shipped', 'release');
        expect(titleHit ?? 0).toBeGreaterThan(bodyHit ?? 0);
    });

    it('rewards a title prefix over a mid-word title hit', () => {
        const prefix = score('Release notes', '', 'release');
        const midword = score('Pre-release', '', 'release');
        expect(prefix ?? 0).toBeGreaterThan(midword ?? 0);
    });

    it('gives a contiguous multi-term phrase a title bonus', () => {
        const phrase = score('Release notes draft', '', 'release notes');
        const split = score('Release the notes', '', 'release notes');
        expect(phrase ?? 0).toBeGreaterThan(split ?? 0);
    });

    it('matches a term that lives only in the body', () => {
        expect(score('Untitled', 'mentions kubernetes once', 'kubernetes')).not.toBeNull();
    });
});

describe('buildSnippet', () => {
    const snippetOf = (content: string, terms: string[]) =>
        buildSnippet(content, content.toLowerCase(), terms);

    it('returns undefined when no term occurs in the body (title-only match)', () => {
        expect(snippetOf('a plain body', ['missing'])).toBeUndefined();
    });

    it('extracts a window around the match with surrounding ellipses', () => {
        const body = `${'x'.repeat(200)} needle ${'y'.repeat(200)}`;
        const snippet = snippetOf(body, ['needle']);
        expect(snippet?.toLowerCase()).toContain('needle');
        expect(snippet?.startsWith('…')).toBe(true);
        expect(snippet?.endsWith('…')).toBe(true);
        expect((snippet ?? '').length).toBeLessThan(body.length);
    });

    it('strips Markdown markers and collapses newlines', () => {
        const snippet = snippetOf('# Heading\n\nThe **needle** here', ['needle']);
        expect(snippet).toContain('needle');
        expect(snippet).not.toContain('**');
        expect(snippet).not.toContain('\n');
    });

    it('omits leading/trailing ellipsis when the match is at the edges', () => {
        const snippet = snippetOf('needle at the very start', ['needle']);
        expect(snippet?.startsWith('…')).toBe(false);
    });

    it('places the match near the start so it stays visible in a truncated preview', () => {
        // Lots of leading text: the snippet must not bury the match deep behind context, or the
        // single-line, ellipsis-truncated list preview would clip the highlighted word off-screen.
        const body = `${'word '.repeat(40)}fraction and some trailing context to fill the line`;
        const snippet = snippetOf(body, ['fraction']);
        expect(snippet?.toLowerCase()).toContain('fraction');
        expect((snippet ?? '').toLowerCase().indexOf('fraction')).toBeLessThan(20);
    });

    it('keeps the match when length-changing lowercase chars precede it (index/slice parity)', () => {
        // 'İ'.toLowerCase() is two UTF-16 units, so content and its lowercase have different lengths;
        // the window must still land on the match rather than drifting off it.
        const body = `${'İ'.repeat(60)} needle ${'y'.repeat(200)}`;
        const snippet = snippetOf(body, ['needle']);
        expect(snippet?.toLowerCase()).toContain('needle');
    });
});

describe('searchNotes', () => {
    const NOTES: NoteMeta[] = [
        {id: 'Alpha.md', title: 'Alpha', updatedAt: 3},
        {id: 'Beta.md', title: 'Beta', updatedAt: 2},
        {id: 'Gamma beta.md', title: 'Gamma beta', updatedAt: 1},
    ];

    it('returns every note unscored for an empty query, original order preserved', () => {
        const results = searchNotes(NOTES, new Map(), '   ');
        expect(results.map((r) => r.note.id)).toEqual(['Alpha.md', 'Beta.md', 'Gamma beta.md']);
    });

    it('ranks title matches, preferring the prefix/word-start hit', () => {
        const results = searchNotes(NOTES, new Map(), 'beta');
        expect(results.map((r) => r.note.id)).toEqual(['Beta.md', 'Gamma beta.md']);
    });

    it('surfaces a body-only match and attaches a snippet', () => {
        const corpus = new Map([['Alpha.md', 'this note talks about kubernetes a lot']]);
        const results = searchNotes(NOTES, corpus, 'kubernetes');
        expect(results.map((r) => r.note.id)).toEqual(['Alpha.md']);
        expect(results[0].snippet).toContain('kubernetes');
    });

    it('floats a title match above a body-only match for the same term', () => {
        const notes: NoteMeta[] = [
            {id: 'Mentions.md', title: 'Mentions', updatedAt: 5},
            {id: 'Docker.md', title: 'Docker', updatedAt: 1},
        ];
        const corpus = new Map([['Mentions.md', 'we use docker in CI']]);
        const results = searchNotes(notes, corpus, 'docker');
        expect(results.map((r) => r.note.id)).toEqual(['Docker.md', 'Mentions.md']);
    });

    it('requires every term to match somewhere (AND across title + body)', () => {
        const corpus = new Map([['Alpha.md', 'alpha mentions widgets']]);
        expect(searchNotes(NOTES, corpus, 'alpha widgets').map((r) => r.note.id)).toEqual([
            'Alpha.md',
        ]);
        expect(searchNotes(NOTES, corpus, 'alpha absent')).toEqual([]);
    });

    it('orders two same-leaf notes deterministically by full path-id, regardless of input order', () => {
        // Same title, same updatedAt: every earlier sort key ties, so the final path-id tiebreak
        // decides — and must give the same result no matter how the store happened to list them.
        const inbox: NoteMeta = {id: 'Inbox/Notes.md', title: 'Notes', updatedAt: 5};
        const archive: NoteMeta = {id: 'Archive/Notes.md', title: 'Notes', updatedAt: 5};
        const expected = ['Archive/Notes.md', 'Inbox/Notes.md'];
        expect(searchNotes([inbox, archive], new Map(), 'notes').map((r) => r.note.id)).toEqual(
            expected,
        );
        expect(searchNotes([archive, inbox], new Map(), 'notes').map((r) => r.note.id)).toEqual(
            expected,
        );
    });
});

describe('searchNotes — precomputed lowercase index', () => {
    const notes: NoteMeta[] = [{id: 'A.md', title: 'A', updatedAt: 1}];

    it('scores + snippets against the supplied lowercased body (no on-the-fly lowercasing)', () => {
        // contentById carries the display (mixed-case) body; lowerById is the search index. A body
        // hit is found and the snippet preserves the original casing from contentById.
        const content = new Map([['A.md', 'About KUBERNETES clusters']]);
        const lower = new Map([['A.md', 'about kubernetes clusters']]);
        const results = searchNotes(notes, content, 'kubernetes', lower);
        expect(results.map((r) => r.note.id)).toEqual(['A.md']);
        expect(results[0].snippet).toContain('KUBERNETES'); // sliced from the original content
    });

    it('produces identical rankings whether or not the index is supplied', () => {
        const corpus: NoteMeta[] = [
            {id: 'Alpha.md', title: 'Alpha', updatedAt: 3},
            {id: 'Beta.md', title: 'Beta', updatedAt: 2},
        ];
        const bodies = new Map([
            ['Alpha.md', 'docker compose notes'],
            ['Beta.md', 'about DOCKER images'],
        ]);
        const lower = new Map([...bodies].map(([id, body]) => [id, body.toLowerCase()] as const));
        const indexed = searchNotes(corpus, bodies, 'docker', lower).map((r) => r.note.id);
        const onTheFly = searchNotes(corpus, bodies, 'docker').map((r) => r.note.id);
        expect(indexed).toEqual(onTheFly);
    });

    it('is authoritative for body scoring — a stale/empty index masks a content-only match', () => {
        // Proves the body text comes from lowerById, not contentById: the content mentions the term
        // but the index does not, so there is no body hit (and the title doesn't match either).
        const content = new Map([['A.md', 'mentions kubernetes']]);
        const emptyIndex = new Map([['A.md', '']]);
        expect(searchNotes(notes, content, 'kubernetes', emptyIndex)).toEqual([]);
    });
});
