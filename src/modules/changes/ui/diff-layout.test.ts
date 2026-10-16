import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from '../model/diff-parser';
import { diffRows, wholeFileRows } from '../model/diff-rows';
import { wholeFile } from '../model/whole-file';
import {
    diffLayout,
    HUNK_ROW_HEIGHT,
    hunkFrom,
    hunksBetween,
    LINE_ROW_HEIGHT,
    openingOffset,
    rowAt,
    spanBox,
} from './diff-layout';

// two hunks of three lines each, under their headers: rows 0-3 and 4-7
const CHANGES = diffRows(
    parseUnifiedDiff(
        ['@@ -1,2 +1,3 @@', ' a', '+b', ' c', '@@ -20,3 +21,2 @@', ' x', '-y', ' z'].join('\n'),
    ).hunks,
);

// a 12-line file with one hunk on lines 3 to 9 (a change on line 6)
const lines = Array.from({ length: 12 }, (_, i) => (i === 5 ? '+six' : ` l${i + 1}`));
const WHOLE = wholeFileRows(
    wholeFile(parseUnifiedDiff(['@@ -1,11 +1,12 @@', ...lines].join('\n')).hunks),
);

describe('diff layout', () => {
    it('places every row from the fixed heights, and the rows of each hunk', () => {
        const layout = diffLayout(CHANGES);
        expect(layout.starts.slice(0, 5)).toEqual([0, 24, 44, 64, 84]);
        expect(layout.hunks).toEqual([
            { first: 0, last: 3 },
            { first: 4, last: 7 },
        ]);
        expect(layout.total).toBe(2 * HUNK_ROW_HEIGHT + 6 * LINE_ROW_HEIGHT);
        expect(spanBox(layout, CHANGES, { first: 4, last: 7 })).toEqual({ top: 84, height: 84 });
    });

    it('marks the lines of the hunks on screen, without their headers', () => {
        const layout = diffLayout(CHANGES);
        expect(hunksBetween(layout, CHANGES, 0, 7)).toEqual([
            { hunk: 0, lines: { first: 1, last: 3 } },
            { hunk: 1, lines: { first: 5, last: 7 } },
        ]);
        expect(hunksBetween(layout, CHANGES, 5, 6).map((h) => h.hunk)).toEqual([1]);
        const file = diffLayout(WHOLE);
        expect(hunksBetween(file, WHOLE, 0, 1)).toEqual([]);
        expect(hunksBetween(file, WHOLE, 10, 11)).toEqual([]);
        expect(hunksBetween(file, WHOLE, 8, 11)).toEqual([
            { hunk: 0, lines: { first: 2, last: 8 } },
        ]);
    });

    it('opens on a hunk, with lines above it in the whole file', () => {
        expect(openingOffset(diffLayout(CHANGES), 1, 0)).toBe(84);
        expect(openingOffset(diffLayout(CHANGES), null, 0)).toBe(0);
        // the hunk starts on row 2: three lines above it are cut at the top
        expect(openingOffset(diffLayout(WHOLE), 0, 3)).toBe(0);
        expect(openingOffset(diffLayout(WHOLE), 5, 3)).toBe(0);
    });

    it('tells the hunk being read at any offset', () => {
        const layout = diffLayout(CHANGES);
        expect(rowAt(layout, 0)).toBe(0);
        expect(rowAt(layout, 30)).toBe(1);
        expect(hunkFrom(layout, CHANGES, rowAt(layout, 90))).toBe(1);
        const file = diffLayout(WHOLE);
        // above the hunk: the next one; below the last: the last
        expect(hunkFrom(file, WHOLE, 0)).toBe(0);
        expect(hunkFrom(file, WHOLE, 11)).toBe(0);
    });
});
