import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from './diff-parser';
import { diffRows, rowsOfLines, textLines, textRows, widestLine } from './diff-rows';

const DIFF = `@@ -1,2 +1,2 @@
 keep
-old
+new
@@ -10 +10 @@ fn main
-\tx
+\t\tlonger line
`;

describe('diff rows', () => {
    const { hunks } = parseUnifiedDiff(DIFF);

    it('puts each hunk header before its lines, in order', () => {
        expect(
            diffRows(hunks).map((row) =>
                row.kind === 'hunk' ? `@${row.hunkIndex}` : `${row.hunkIndex}:${row.line.text}`,
            ),
        ).toEqual(['@0', '0:keep', '0:old', '0:new', '@1', '1:\tx', '1:\t\tlonger line']);
    });

    it('measures the widest line in columns, with tabs to the next stop of 8', () => {
        // two tabs reach column 16, then 11 characters
        expect(widestLine(hunks)).toBe(27);
        expect(
            widestLine(parseUnifiedDiff('@@ -1 +1 @@ a much longer section name\n-a\n+b\n').hunks),
        ).toBe('@@ -1 +1 @@ a much longer section name'.length);
        expect(widestLine([])).toBe(0);
    });

    it("numbers a file's lines as a diff that changes none", () => {
        const lines = textLines('a\n\tbb\n');
        expect(lines.map((line) => [line.newNumber, line.oldNumber, line.text])).toEqual([
            [1, 1, 'a'],
            [2, 2, '\tbb'],
        ]);
        expect(textLines('last')).toHaveLength(1);
        expect(textLines('')).toEqual([]);
        const { rows, widest } = textRows(lines);
        expect(rows.every((row) => row.hunkIndex === -1)).toBe(true);
        expect(widest).toBe(10);
    });

    it('finds the rows of some lines of the file as it is now', () => {
        const rows = diffRows(hunks);
        // `keep` and `new` are lines 1 and 2 now; `old` is not in the file any more
        expect(rowsOfLines(rows, { first: 1, last: 2 })).toEqual({ first: 1, last: 3 });
        expect(rowsOfLines(rows, { first: 2, last: 2 })).toEqual({ first: 3, last: 3 });
        expect(rowsOfLines(rows, { first: 5, last: 10 })).toEqual({ first: 6, last: 6 });
        expect(rowsOfLines(rows, { first: 40, last: 41 })).toBeNull();
    });
});
