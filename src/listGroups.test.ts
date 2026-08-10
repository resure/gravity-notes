import {describe, expect, it} from 'vitest';

import {buildListRows} from './listGroups';
import type {NoteMeta} from './storage/types';

const NOW = new Date(2026, 7, 10, 14, 30).getTime(); // 10 Aug 2026, local

function note(id: string, title: string, updatedAt?: number): NoteMeta {
    return {id, title, updatedAt};
}

const labels = (rows: ReturnType<typeof buildListRows>) =>
    rows.filter((r) => r.kind === 'group').map((r) => (r.kind === 'group' ? r.label : ''));

const order = (rows: ReturnType<typeof buildListRows>) =>
    rows.map((r) => (r.kind === 'group' ? `# ${r.label}` : r.note.id));

describe('buildListRows', () => {
    it('groups by day for date sorts, with pins first', () => {
        const rows = buildListRows(
            [
                note('p.md', 'Pinned one', NOW - 3 * 86400000),
                note('a.md', 'Today', NOW - 3600000),
                note('b.md', 'Also today', NOW - 7200000),
                note('c.md', 'Yesterday', NOW - 26 * 3600000),
                note('d.md', 'Older', NOW - 9 * 86400000),
            ],
            {sort: 'updated', pinned: ['p.md'], now: NOW},
        );
        expect(order(rows)).toEqual([
            '# Pinned',
            'p.md',
            '# Today',
            'a.md',
            'b.md',
            '# Yesterday',
            'c.md',
            '# Earlier',
            'd.md',
        ]);
    });

    it('buckets by calendar day, not by 24-hour multiples', () => {
        // 00:30 today and 23:30 yesterday are 1 hour apart but belong to different days.
        const justAfterMidnight = new Date(2026, 7, 10, 0, 30).getTime();
        const lateYesterday = new Date(2026, 7, 9, 23, 30).getTime();
        const rows = buildListRows(
            [note('a.md', 'A', justAfterMidnight), note('b.md', 'B', lateYesterday)],
            {sort: 'updated', pinned: [], now: NOW},
        );
        expect(labels(rows)).toEqual(['Today', 'Yesterday']);
    });

    it('uses the created stamp for the created sort', () => {
        const rows = buildListRows([note('a.md', 'A', NOW)], {
            sort: 'created',
            pinned: [],
            created: {'a.md': NOW - 5 * 86400000},
            now: NOW,
        });
        // Touched today, made last week — grouped by when it was made.
        expect(labels(rows)).toEqual(['Earlier']);
    });

    it('groups by letter for title sorts, in both languages', () => {
        const rows = buildListRows(
            [
                note('a.md', 'Alpha'),
                note('b.md', 'apple'),
                note('c.md', 'Beta'),
                note('r.md', 'Релиз'),
                note('n.md', '12 things'),
            ],
            {sort: 'title', pinned: [], now: NOW},
        );
        expect(labels(rows)).toEqual(['A', 'B', 'Р', '#']);
    });

    it('leaves search results ungrouped — a ranked list has no active sort to follow', () => {
        const rows = buildListRows([note('a.md', 'A', NOW), note('b.md', 'B', NOW - 1e9)], {
            sort: 'updated',
            pinned: ['a.md'],
            now: NOW,
            grouped: false,
        });
        expect(order(rows)).toEqual(['a.md', 'b.md']);
    });

    it('files a note with no timestamp under Earlier rather than dropping it', () => {
        const rows = buildListRows([note('a.md', 'A')], {sort: 'updated', pinned: [], now: NOW});
        expect(order(rows)).toEqual(['# Earlier', 'a.md']);
    });
});
