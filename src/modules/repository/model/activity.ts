import type { CommitActivity } from './repository.types';

/** The days of a card's chart: today and the six before it. */
export const ACTIVITY_DAYS = 7;

/** A day of work: the lines its commits added and removed. */
export interface ActivityDay {
    /** The local midnight it starts at, in seconds since the Unix epoch. */
    start: number;
    additions: number;
    deletions: number;
    commits: number;
}

/** The local midnight `ACTIVITY_DAYS - 1` days before `now`, in seconds: the chart's first day. */
export function activitySince(now: Date): number {
    const first = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (ACTIVITY_DAYS - 1));
    return first.getTime() / 1000;
}

/** The commits of `activity` by local day from `since`, oldest first; days are local, DST included. */
export function activityDays(activity: CommitActivity, since: number): ActivityDay[] {
    const first = new Date(since * 1000);
    const days = Array.from({ length: ACTIVITY_DAYS }, (_, index) => ({
        start:
            new Date(first.getFullYear(), first.getMonth(), first.getDate() + index).getTime() /
            1000,
        additions: 0,
        deletions: 0,
        commits: 0,
    }));
    for (const commit of activity.commits) {
        // the last day started by then: a commit dated ahead of the clock counts today
        let index = days.length - 1;
        while (index >= 0 && days[index].start > commit.time) index--;
        if (index < 0) continue;
        days[index].additions += commit.additions;
        days[index].deletions += commit.deletions;
        days[index].commits++;
    }
    return days;
}
