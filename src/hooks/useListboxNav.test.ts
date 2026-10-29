import {describe, expect, it} from 'vitest';

import {domIdPart} from './useListboxNav';

describe('domIdPart', () => {
    it('preserves ASCII letters, digits and hyphens', () => {
        expect(domIdPart('Vault-A1-z9')).toBe('Vault-A1-z9');
    });

    it.each([
        ['!a', '\u021a'],
        ['A/a', 'A\u02fa'],
        ['!', '_0021'],
        [' ', '_0020'],
        ['😀', '_d83d_de00'],
    ])('keeps %j distinct from %j', (left, right) => {
        expect(domIdPart(left)).not.toBe(domIdPart(right));
    });

    it('makes a whitespace-free IDREF from a workspace path', () => {
        expect(domIdPart('tauri:/My Vault/\tNotes\n')).not.toMatch(/\s/);
    });
});
