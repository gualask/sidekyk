import { describe, expect, it } from 'vitest';
import { localMidnight } from './local-day';

describe('localMidnight', () => {
    it('starts the day, forward or back, across a month and a year', () => {
        expect(localMidnight(new Date(2026, 10, 15, 18, 42), 0)).toEqual(new Date(2026, 10, 15));
        expect(localMidnight(new Date(2026, 10, 15, 18, 42), -6)).toEqual(new Date(2026, 10, 9));
        expect(localMidnight(new Date(2026, 11, 31, 23, 59), 1)).toEqual(new Date(2027, 0, 1));
        expect(localMidnight(new Date(2026, 2, 1, 0, 30), -1)).toEqual(new Date(2026, 1, 28));
    });

    it('stays on midnight across a change of the clocks', () => {
        // the last Sundays of March and October change the clocks in Europe; anywhere, a midnight
        // a week on is still a midnight
        for (const from of [new Date(2026, 2, 26, 12), new Date(2026, 9, 22, 12)]) {
            const day = localMidnight(from, 7);
            const calendar = new Date(from);
            calendar.setDate(from.getDate() + 7);
            expect([day.getHours(), day.getMinutes()]).toEqual([0, 0]);
            expect([day.getMonth(), day.getDate()]).toEqual([
                calendar.getMonth(),
                calendar.getDate(),
            ]);
        }
    });
});
