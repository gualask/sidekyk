import { describe, expect, it } from 'vitest';
import { relativeTime } from './relative-time';

describe('relativeTime', () => {
    it('says how long ago in the fewest letters', () => {
        const now = 1_000_000_000;
        expect(relativeTime(now - 5, now)).toBe('now');
        expect(relativeTime(now + 60, now)).toBe('now');
        expect(relativeTime(now - 5 * 60, now)).toBe('5m');
        expect(relativeTime(now - 3 * 3600, now)).toBe('3h');
        expect(relativeTime(now - 2 * 86400, now)).toBe('2d');
        expect(relativeTime(now - 15 * 86400, now)).toBe('2w');
        expect(relativeTime(now - 65 * 86400, now)).toBe('2mo');
        expect(relativeTime(now - 800 * 86400, now)).toBe('2y');
    });
});
