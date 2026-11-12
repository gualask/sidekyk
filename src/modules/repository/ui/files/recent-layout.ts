import { splitPath } from '../../model/tree/file-groups';
import type { RecentGroup, RecentRow } from '../../model/tree/recent-files';

/** Recent's rows: their room on each side, before the folder and before the time, in pixels. */
export const RECENT_PADDING_X = 12;
export const RECENT_DIR_GAP = 6;
export const RECENT_TIME_GAP = 12;
/** The folder's and the time's size, in pixels, smaller than the name's. */
export const RECENT_SMALL_FONT = 11;

/**
 * What Recent needs to show every row whole, from its fonts' widths: the name, its folder and its
 * time, as `formats` writes it.
 */
export function recentFittingWidth(
    rows: readonly RecentRow[],
    formats: TimeFormats,
    element: HTMLElement,
): number {
    const style = getComputedStyle(element);
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return 0;
    const files = rows.flatMap((row) => (row.kind === 'file' ? [row] : []));
    // one font at a time: setting it costs more than a measure
    context.font = `${style.fontSize} ${style.fontFamily}`;
    const widths = files.map((row) => context.measureText(splitPath(row.file.path).name).width);
    context.font = `${RECENT_SMALL_FONT}px ${style.fontFamily}`;
    let widest = 0;
    files.forEach((row, index) => {
        const { dir } = splitPath(row.file.path);
        const time = formats.short(row.file.modified, row.group);
        const width =
            (widths[index] ?? 0) +
            (dir ? RECENT_DIR_GAP + context.measureText(dir).width : 0) +
            RECENT_TIME_GAP +
            context.measureText(time).width;
        widest = Math.max(widest, width);
    });
    return Math.ceil(widest + 2 * RECENT_PADDING_X);
}

/**
 * How a time shows in each group: the hour today and yesterday, the weekday and hour in the week,
 * then the date, with its year when not this one; `whole` for the tooltip.
 */
export function timeFormats(tag: string, now: number) {
    const time = new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit' });
    const weekday = new Intl.DateTimeFormat(tag, {
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
    });
    const date = new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short' });
    const dated = new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short', year: 'numeric' });
    const whole = new Intl.DateTimeFormat(tag, { dateStyle: 'full', timeStyle: 'short' });
    const year = new Date(now).getFullYear();
    return {
        short: (modified: number, group: RecentGroup) => {
            if (group === 'today' || group === 'yesterday') return time.format(modified);
            if (group === 'week') return weekday.format(modified);
            return new Date(modified).getFullYear() === year
                ? date.format(modified)
                : dated.format(modified);
        },
        whole: (modified: number) => whole.format(modified),
    };
}

export type TimeFormats = ReturnType<typeof timeFormats>;
