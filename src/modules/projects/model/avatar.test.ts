import { describe, expect, it } from 'vitest';
import { avatarColor, avatarLetter } from './avatar';

describe('avatarColor', () => {
    it('is one of the six avatar tokens, always the same for a root', () => {
        const color = avatarColor('/Users/dev/Projects/shop');
        expect(color).toMatch(/^var\(--ui-avatar-[1-6]\)$/);
        expect(avatarColor('/Users/dev/Projects/shop')).toBe(color);
    });

    it('spreads projects over the colors', () => {
        const roots = Array.from({ length: 24 }, (_, i) => `/Users/dev/Projects/p${i}`);
        expect(new Set(roots.map(avatarColor)).size).toBeGreaterThan(3);
    });
});

describe('avatarLetter', () => {
    it('takes the first character, capitalized', () => {
        expect(avatarLetter('sidekyk')).toBe('S');
        expect(avatarLetter('élan')).toBe('É');
        expect(avatarLetter('')).toBe('?');
    });
});
