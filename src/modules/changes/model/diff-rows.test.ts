import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from './diff-parser';
import { diffRows, widestLine } from './diff-rows';

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
});
