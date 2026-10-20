import type { Translator } from '@/shared/i18n';

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * How long ago something happened, as short as a list row allows: `now`, `5m`, `3h`, `2d`… in
 * English, `ora`, `5 min`, `3 h`, `2 g`… in Italian.
 */
export function relativeTime(seconds: number, nowSeconds: number, i18n: Translator): string {
    const ago = Math.max(0, nowSeconds - seconds);
    if (ago < MINUTE) return i18n.t('time.now');
    if (ago < HOUR) return i18n.tp('time.minutes', Math.floor(ago / MINUTE));
    if (ago < DAY) return i18n.tp('time.hours', Math.floor(ago / HOUR));
    if (ago < WEEK) return i18n.tp('time.days', Math.floor(ago / DAY));
    if (ago < MONTH) return i18n.tp('time.weeks', Math.floor(ago / WEEK));
    if (ago < YEAR) return i18n.tp('time.months', Math.floor(ago / MONTH));
    return i18n.tp('time.years', Math.floor(ago / YEAR));
}

/** How long ago, in words: `just now`, `5m ago`; `adesso`, `5 min fa`. */
export function timeAgo(seconds: number, nowSeconds: number, i18n: Translator): string {
    if (nowSeconds - seconds < MINUTE) return i18n.t('time.justNow');
    return i18n.t('time.ago', { time: relativeTime(seconds, nowSeconds, i18n) });
}

/** The most characters `relativeTime` writes in a language: a column of them stays this wide. */
export function relativeTimeWidth(i18n: Translator): number {
    const longest = [MINUTE * 59, HOUR * 23, DAY * 6, WEEK * 4, MONTH * 11, YEAR * 99];
    return Math.max(...longest.map((ago) => relativeTime(0, ago, i18n).length));
}
