import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from '../model/diff-parser';
import { diffRows, wholeFileRows } from '../model/diff-rows';
import { wholeFile } from '../model/whole-file';
import { diffLayout } from './diff-layout';
import { sameTarget, targetAt, targetSpan } from './diff-target';

const ROWS = diffRows(parseUnifiedDiff(['@@ -1,2 +1,3 @@', ' a', '+b', ' c'].join('\n')).hunks);

describe('diff targets', () => {
    it('copies a hunk from its header or its gutter, a line from its code', () => {
        expect(targetAt(ROWS, 0, false)).toEqual({ kind: 'hunk', hunk: 0 });
        expect(targetAt(ROWS, 2, true)).toEqual({ kind: 'hunk', hunk: 0 });
        expect(targetAt(ROWS, 2, false)).toEqual({ kind: 'line', row: 2 });
        expect(targetAt(ROWS, 9, false)).toBeNull();
    });

    it('copies a line outside every hunk from its gutter too', () => {
        const lines = ['@@ -1,9 +1,9 @@', ...Array.from({ length: 9 }, (_, i) => ` l${i}`)];
        lines[9] = '-l8';
        lines.push('+L8');
        const rows = wholeFileRows(wholeFile(parseUnifiedDiff(lines.join('\n')).hunks));
        expect(targetAt(rows, 0, true)).toEqual({ kind: 'line', row: 0 });
    });

    it('spans the rows a target takes', () => {
        const layout = diffLayout(ROWS);
        expect(targetSpan(layout, { kind: 'hunk', hunk: 0 })).toEqual({ first: 0, last: 3 });
        expect(targetSpan(layout, { kind: 'line', row: 2 })).toEqual({ first: 2, last: 2 });
        expect(sameTarget({ kind: 'line', row: 2 }, { kind: 'line', row: 2 })).toBe(true);
        expect(sameTarget({ kind: 'line', row: 2 }, { kind: 'hunk', hunk: 2 })).toBe(false);
        expect(sameTarget(null, null)).toBe(true);
    });
});
