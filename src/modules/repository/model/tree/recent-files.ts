import type { RecentFile } from '../repository.types';

/** When a file changed, by the local calendar, as a file manager groups by date modified. */
export type RecentGroup = 'today' | 'yesterday' | 'week' | 'month' | 'earlier';

/** Each group's heading in the catalogs. */
export const RECENT_GROUP_LABEL = {
    today: 'files.recent.today',
    yesterday: 'files.recent.yesterday',
    week: 'files.recent.week',
    month: 'files.recent.month',
    earlier: 'files.recent.earlier',
} as const satisfies Record<RecentGroup, string>;

export type RecentRow =
    | { kind: 'group'; group: RecentGroup; count: number; first: boolean }
    | { kind: 'file'; file: RecentFile; group: RecentGroup }
    /** Older files the list does not hold. */
    | { kind: 'more'; count: number };

/** Local midnight `days` days before the day of `now`, in milliseconds. */
function midnight(now: number, days: number): number {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - days);
    return day.getTime();
}

/**
 * The group of a change at `modified`, seen at `now`: today, yesterday, the 7 days before today,
 * the 30 days before today, or earlier. A time ahead of the clock is today.
 */
export function recentGroupOf(now: number): (modified: number) => RecentGroup {
    const bounds: [number, RecentGroup][] = [
        [midnight(now, 0), 'today'],
        [midnight(now, 1), 'yesterday'],
        [midnight(now, 7), 'week'],
        [midnight(now, 30), 'month'],
    ];
    return (modified) => bounds.find(([start]) => modified >= start)?.[1] ?? 'earlier';
}

/** The list's rows: a heading per group with its count, its files newest first, then the rest. */
export function recentRows(files: readonly RecentFile[], more: number, now: number): RecentRow[] {
    const groupOf = recentGroupOf(now);
    const rows: RecentRow[] = [];
    const headings: Extract<RecentRow, { kind: 'group' }>[] = [];
    for (const file of files) {
        const group = groupOf(file.modified);
        let heading = headings.at(-1);
        if (heading?.group !== group) {
            heading = { kind: 'group', group, count: 0, first: headings.length === 0 };
            headings.push(heading);
            rows.push(heading);
        }
        heading.count++;
        rows.push({ kind: 'file', file, group });
    }
    if (more > 0) rows.push({ kind: 'more', count: more });
    return rows;
}

export type RecentMove = { kind: 'select'; path: string } | { kind: 'open'; path: string };

/**
 * As the tree: `↓`/`↑` (`j`/`k`) move among the files, `↵` and `Space` open the one selected.
 * Nothing for any other key, or where the selection cannot go.
 */
export function recentMove(
    rows: readonly RecentRow[],
    selected: string | null,
    key: string,
): RecentMove | null {
    const files = rows.flatMap((row) => (row.kind === 'file' ? [row.file.path] : []));
    const at = selected === null ? -1 : files.indexOf(selected);
    const select = (index: number): RecentMove | null => {
        const path = files[index];
        return path === undefined ? null : { kind: 'select', path };
    };
    if (key === 'ArrowDown' || key === 'j') return select(at + 1);
    if (key === 'ArrowUp' || key === 'k') return select(at < 0 ? 0 : at - 1);
    if ((key === 'Enter' || key === ' ') && at >= 0 && selected !== null) {
        return { kind: 'open', path: selected };
    }
    return null;
}
