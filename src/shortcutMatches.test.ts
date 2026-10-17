import {describe, expect, it} from 'vitest';

import {GLOBAL_CHORDS, SHORTCUTS, normalizeChord, shortcutMatches} from './shortcuts';

const matching = (query: string) =>
    SHORTCUTS.filter((shortcut) => shortcutMatches(shortcut, query)).map((s) => s.keys);

describe('shortcutMatches', () => {
    it('finds a shortcut by what it does', () => {
        expect(matching('go back')).toEqual(['mod+alt+[']);
        expect(matching('PREVIEW')).toContain('mod+shift+p');
    });

    it('reads a chord however it is spelled', () => {
        for (const query of ['cmd+k', 'cmd-k', 'CMD K', '⌘K', '⌘k', 'command+k', 'mod+k']) {
            expect(matching(query), query).toContain('mod+k');
            expect(matching(query), query).not.toContain('mod+b');
        }
        expect(matching('⌘⇧;')).toEqual(['mod+shift+;']);
        expect(matching('opt+cmd+[')).toEqual(['mod+alt+[']);
        expect(matching('ctrl-r')).toContain('ctrl+r');
    });

    it('treats a modifier alone as a key', () => {
        const withOption = matching('⌥');
        expect(withOption.length).toBeGreaterThan(0);
        expect(withOption.every((keys) => keys.includes('alt'))).toBe(true);
    });

    it('keeps everything for an empty query', () => {
        expect(matching('  ')).toHaveLength(SHORTCUTS.length);
    });
});

describe('GLOBAL_CHORDS', () => {
    it('holds the chords the global handler fires while typing, and nothing list-only', () => {
        expect(GLOBAL_CHORDS.has(normalizeChord(['mod', '/']))).toBe(true);
        expect(GLOBAL_CHORDS.has(normalizeChord(['Mod', 'Shift', '\\']))).toBe(true);
        expect(GLOBAL_CHORDS.has(normalizeChord(['mod', 'shift', 'm']))).toBe(false);
    });
});
