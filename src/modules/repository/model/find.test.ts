import { describe, expect, it } from 'vitest';
import type { DiffLine } from './diff-parser';
import type { DiffRow } from './diff-rows';
import { findMatches, matchFrom } from './find';

function line(text: string, newNumber: number | null, kind: DiffLine['kind'] = 'context'): DiffRow {
    return {
        kind: 'line',
        line: { id: 0, kind, text, oldNumber: newNumber, newNumber },
        hunkIndex: -1,
    };
}

describe('find in the viewer', () => {
    const rows = [
        line('let total = Total;', 1),
        line('total(a.b)', null, 'del'),
        line('no match', 2),
        line('total', 3),
    ];

    it('finds every place, case ignored unless the text has a capital', () => {
        expect(findMatches(rows, 'total')).toEqual([
            { row: 0, start: 4, end: 9 },
            { row: 0, start: 12, end: 17 },
            { row: 1, start: 0, end: 5 },
            { row: 3, start: 0, end: 5 },
        ]);
        expect(findMatches(rows, 'Total')).toEqual([{ row: 0, start: 12, end: 17 }]);
        expect(findMatches(rows, 'a.b')).toEqual([{ row: 1, start: 6, end: 9 }]);
        expect(findMatches(rows, '')).toEqual([]);
    });

    it('starts on the line asked for, or the next with a match, passing over removed lines', () => {
        const matches = findMatches(rows, 'total');
        expect(matchFrom(matches, rows, null)).toBe(0);
        expect(matchFrom(matches, rows, 2)).toBe(3);
        expect(matchFrom(matches, rows, 9)).toBe(0);
    });
});
