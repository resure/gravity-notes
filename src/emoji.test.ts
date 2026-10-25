import {describe, expect, it} from 'vitest';

import {emojiIcon, filterEmojis, loadEmojis} from './emoji';

describe('emojiIcon', () => {
    it('shows an emoji and hides an older build’s icon name', () => {
        expect(emojiIcon('🚀')).toBe('🚀');
        expect(emojiIcon('Star')).toBeNull();
        expect(emojiIcon('')).toBeNull();
        expect(emojiIcon(undefined)).toBeNull();
    });
});

describe('the emoji catalog', () => {
    it('loads once and filters by name or keyword', async () => {
        const all = await loadEmojis();
        expect(await loadEmojis()).toBe(all);
        expect(all.length).toBeGreaterThan(1000);
        expect(filterEmojis('rocket', all).map((e) => e.char)).toContain('🚀');
        expect(filterEmojis('  ', all)).toBe(all);
    });
});
