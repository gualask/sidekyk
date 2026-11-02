import { describe, expect, it } from 'vitest';
import { recentGroupOf, recentMove, recentRows } from './recent-files';

/** Monday 2 November 2026, 10:30 local time. */
const NOW = new Date(2026, 10, 2, 10, 30).getTime();
const at = (month: number, day: number, hour = 12) => new Date(2026, month, day, hour).getTime();

describe('recentGroupOf', () => {
    const groupOf = recentGroupOf(NOW);

    it('groups by the local calendar day, not by hours ago', () => {
        expect(groupOf(at(10, 2, 0))).toBe('today');
        expect(groupOf(at(10, 1, 23))).toBe('yesterday');
        expect(groupOf(at(10, 1, 0))).toBe('yesterday');
        expect(groupOf(at(9, 31, 23))).toBe('week');
    });

    it('takes 7 and 30 days before today, then earlier', () => {
        expect(groupOf(at(9, 26, 0))).toBe('week');
        expect(groupOf(at(9, 25, 23))).toBe('month');
        expect(groupOf(at(9, 3, 0))).toBe('month');
        expect(groupOf(at(9, 2, 23))).toBe('earlier');
    });

    it('counts a time ahead of the clock as today', () => {
        expect(groupOf(NOW + 60_000)).toBe('today');
    });
});

describe('recentRows', () => {
    it('heads each group with its count, and counts the files left out', () => {
        const files = [
            { path: 'a.md', modified: at(10, 2, 9) },
            { path: 'b.md', modified: at(10, 2, 8) },
            { path: 'c.md', modified: at(9, 20) },
        ];
        expect(recentRows(files, 4, NOW)).toEqual([
            { kind: 'group', group: 'today', count: 2, first: true },
            { kind: 'file', file: files[0], group: 'today' },
            { kind: 'file', file: files[1], group: 'today' },
            { kind: 'group', group: 'month', count: 1, first: false },
            { kind: 'file', file: files[2], group: 'month' },
            { kind: 'more', count: 4 },
        ]);
    });

    it('is empty without files', () => {
        expect(recentRows([], 0, NOW)).toEqual([]);
    });
});

describe('recentMove', () => {
    const rows = recentRows(
        [
            { path: 'a.md', modified: at(10, 2) },
            { path: 'b.md', modified: at(9, 1) },
        ],
        0,
        NOW,
    );

    it('moves among the files, over the headings', () => {
        expect(recentMove(rows, null, 'j')).toEqual({ kind: 'select', path: 'a.md' });
        expect(recentMove(rows, null, 'k')).toEqual({ kind: 'select', path: 'a.md' });
        expect(recentMove(rows, 'a.md', 'ArrowDown')).toEqual({ kind: 'select', path: 'b.md' });
        expect(recentMove(rows, 'b.md', 'k')).toEqual({ kind: 'select', path: 'a.md' });
        expect(recentMove(rows, 'b.md', 'j')).toBeNull();
        expect(recentMove(rows, 'a.md', 'ArrowUp')).toBeNull();
    });

    it('opens the file selected, if it is listed', () => {
        expect(recentMove(rows, 'b.md', 'Enter')).toEqual({ kind: 'open', path: 'b.md' });
        expect(recentMove(rows, 'a.md', ' ')).toEqual({ kind: 'open', path: 'a.md' });
        expect(recentMove(rows, 'gone.md', 'Enter')).toBeNull();
        expect(recentMove(rows, null, 'Enter')).toBeNull();
        expect(recentMove(rows, 'a.md', 'ArrowRight')).toBeNull();
    });

    it('starts from the first file when the one selected is not listed', () => {
        expect(recentMove(rows, 'gone.md', 'j')).toEqual({ kind: 'select', path: 'a.md' });
    });
});
