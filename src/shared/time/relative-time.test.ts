import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/shared/i18n';
import { relativeTime, relativeTimeWidth, timeAgo } from './relative-time';

const en = createTranslator('en', 'en');
const it_ = createTranslator('it', 'it');

describe('relativeTime', () => {
    it('says how long ago in the fewest letters', () => {
        const now = 1_000_000_000;
        expect(relativeTime(now - 5, now, en)).toBe('now');
        expect(relativeTime(now + 60, now, en)).toBe('now');
        expect(relativeTime(now - 5 * 60, now, en)).toBe('5m');
        expect(relativeTime(now - 3 * 3600, now, en)).toBe('3h');
        expect(relativeTime(now - 2 * 86400, now, en)).toBe('2d');
        expect(relativeTime(now - 15 * 86400, now, en)).toBe('2w');
        expect(relativeTime(now - 65 * 86400, now, en)).toBe('2mo');
        expect(relativeTime(now - 800 * 86400, now, en)).toBe('2y');
    });

    it('speaks the UI language', () => {
        const now = 1_000_000_000;
        expect(relativeTime(now - 5, now, it_)).toBe('ora');
        expect(relativeTime(now - 5 * 60, now, it_)).toBe('5 min');
        expect(relativeTime(now - 2 * 86400, now, it_)).toBe('2 g');
        expect(relativeTime(now - 35 * 86400, now, it_)).toBe('1 mese');
        expect(relativeTime(now - 65 * 86400, now, it_)).toBe('2 mesi');
        expect(relativeTime(now - 400 * 86400, now, it_)).toBe('1 anno');
    });

    it('says how long ago in words', () => {
        const now = 1_000_000_000;
        expect(timeAgo(now - 5, now, en)).toBe('just now');
        expect(timeAgo(now - 3 * 3600, now, en)).toBe('3h ago');
        expect(timeAgo(now - 3 * 3600, now, it_)).toBe('3 h fa');
    });

    it('knows how wide its column must be', () => {
        expect(relativeTimeWidth(en)).toBe(4);
        expect(relativeTimeWidth(it_)).toBe(7);
    });
});
