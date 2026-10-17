const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** How long ago something happened, as short as a list row allows: `now`, `5m`, `3h`, `2d`… */
export function relativeTime(seconds: number, nowSeconds: number): string {
    const ago = Math.max(0, nowSeconds - seconds);
    if (ago < MINUTE) return 'now';
    if (ago < HOUR) return `${Math.floor(ago / MINUTE)}m`;
    if (ago < DAY) return `${Math.floor(ago / HOUR)}h`;
    if (ago < WEEK) return `${Math.floor(ago / DAY)}d`;
    if (ago < MONTH) return `${Math.floor(ago / WEEK)}w`;
    if (ago < YEAR) return `${Math.floor(ago / MONTH)}mo`;
    return `${Math.floor(ago / YEAR)}y`;
}
