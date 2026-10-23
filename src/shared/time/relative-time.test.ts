import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/shared/i18n';
import { dayAgo, relativeTime, relativeTimeWidth, timeAgo } from './relative-time';

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

describe('dayAgo', () => {
    // noon, so that hours back stay on the day meant
    const now = new Date(2026, 9, 23, 12).getTime();
    const daysBack = (days: number, hour = 12) => new Date(2026, 9, 23 - days, hour).getTime();

    it('counts calendar days, not hours', () => {
        expect(dayAgo(daysBack(0, 0), now, 'en')).toBe('today');
        expect(dayAgo(daysBack(1, 23), now, 'en')).toBe('yesterday');
        expect(dayAgo(daysBack(3), now, 'en')).toBe('3 days ago');
        expect(dayAgo(now + 3600_000, now, 'en')).toBe('today');
    });

    it('goes to weeks, months and years', () => {
        expect(dayAgo(daysBack(15), now, 'en')).toBe('2 weeks ago');
        expect(dayAgo(daysBack(65), now, 'en')).toBe('2 months ago');
        expect(dayAgo(daysBack(800), now, 'en')).toBe('2 years ago');
    });

    it('speaks the UI language', () => {
        expect(dayAgo(daysBack(0), now, 'it')).toBe('oggi');
        expect(dayAgo(daysBack(1), now, 'it')).toBe('ieri');
        expect(dayAgo(daysBack(3), now, 'it')).toBe('3 giorni fa');
    });
});
