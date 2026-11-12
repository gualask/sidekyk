import { describe, expect, it } from 'vitest';
import { avatarLetters, nameLetters } from './avatar';

describe('nameLetters', () => {
    it('takes the first letters of the first and last words', () => {
        expect(nameLetters('my-shop-api')).toBe('ma');
        expect(nameLetters('Sidekyk Docs')).toBe('SD');
        expect(nameLetters('web3 app')).toBe('wa');
        expect(nameLetters('  dati_2024  ')).toBe('d2');
    });

    it('takes a single word humps, or its first letter', () => {
        expect(nameLetters('SideKyk')).toBe('SK');
        expect(nameLetters('iOS')).toBe('iO');
        expect(nameLetters('README')).toBe('R');
        expect(nameLetters('shop')).toBe('s');
        expect(nameLetters('élan')).toBe('é');
    });

    it('falls back on the first character of a name without words', () => {
        expect(nameLetters('—')).toBe('—');
        expect(nameLetters('')).toBe('?');
    });
});

describe('avatarLetters', () => {
    it('shows the letters written, else the name s, capitalized', () => {
        const shop = { name: 'shop', avatar: { color: 1, letters: null } };
        expect(avatarLetters(shop)).toBe('S');
        expect(avatarLetters({ ...shop, avatar: { color: 1, letters: 'sw' } })).toBe('SW');
    });
});
