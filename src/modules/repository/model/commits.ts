import type { Commit, CommitRequest } from './repository.types';

/** The abbreviated hash the UI shows, as long as the branch's commit in the summary. */
export function shortSha(sha: string): string {
    return sha.slice(0, 7);
}

/** What the backend needs to name a commit, without the rest of it on the wire. */
export function commitRequest(commit: Commit): CommitRequest {
    return { sha: commit.sha, parent: commit.parent };
}

/** When a commit was made, in full, for a tooltip. */
export function commitDate(commit: Commit): string {
    return new Date(commit.time * 1000).toLocaleString();
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** How long ago a commit was made, as short as a list row allows: `now`, `5m`, `3h`, `2d`… */
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
