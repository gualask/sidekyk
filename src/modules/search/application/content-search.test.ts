import { describe, expect, it } from 'vitest';
import { longEnoughToSearch } from './content-search';

describe('longEnoughToSearch', () => {
    it('counts characters as the backend does, a code point each', () => {
        expect(longEnoughToSearch('😀')).toBe(false);
        expect(longEnoughToSearch('😀😀')).toBe(true);
        expect(longEnoughToSearch('ab')).toBe(true);
    });

    it('leaves out the spaces around the text', () => {
        expect(longEnoughToSearch(' a ')).toBe(false);
        expect(longEnoughToSearch(' a b')).toBe(true);
    });
});
