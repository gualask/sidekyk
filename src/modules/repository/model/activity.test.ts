import { describe, expect, it } from 'vitest';
import { ACTIVITY_DAYS, activityDays, activitySince, mergedActivity } from './activity';

const at = (day: number, hour: number) => new Date(2026, 9, day, hour).getTime() / 1000;

describe('activityDays', () => {
    it('starts at local midnight six days before today', () => {
        expect(activitySince(new Date(2026, 9, 18, 15, 30))).toBe(at(12, 0));
    });

    it('adds up the commits of each local day, oldest day first', () => {
        const since = activitySince(new Date(2026, 9, 18, 15));
        const days = activityDays(
            {
                commits: [
                    { time: at(18, 9), additions: 5, deletions: 1 },
                    { time: at(18, 8), additions: 2, deletions: 0 },
                    { time: at(12, 0), additions: 1, deletions: 3 },
                    { time: at(11, 23), additions: 9, deletions: 9 },
                ],
                more: false,
            },
            since,
        );
        expect(days).toHaveLength(ACTIVITY_DAYS);
        expect(days[0]).toEqual({ start: at(12, 0), additions: 1, deletions: 3, commits: 1 });
        expect(days[6]).toEqual({ start: at(18, 0), additions: 7, deletions: 1, commits: 2 });
        expect(days.slice(1, 6).every((day) => day.commits === 0)).toBe(true);
    });
});

describe('mergedActivity', () => {
    it("puts several repositories' commits in one chart", () => {
        const api = { commits: [{ time: 10, additions: 3, deletions: 1 }], more: false };
        const web = { commits: [{ time: 20, additions: 5, deletions: 0 }], more: true };
        expect(mergedActivity([api, web])).toEqual({
            commits: [...api.commits, ...web.commits],
            more: true,
        });
        expect(mergedActivity([])).toEqual({ commits: [], more: false });
    });
});
