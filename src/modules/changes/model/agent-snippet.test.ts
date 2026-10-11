import { describe, expect, it } from 'vitest';
import { formatFileForAgent, formatHunkForAgent, hunkLocation } from './agent-snippet';
import { parseUnifiedDiff } from './diff-parser';

function hunksOf(lines: string[]) {
    return parseUnifiedDiff(lines.join('\n')).hunks;
}

function firstHunk(lines: string[]) {
    const [hunk] = hunksOf(lines);
    if (!hunk) throw new Error('fixture has no hunk');
    return hunk;
}

describe('agent snippets', () => {
    it('formats a hunk as its location and a diff fence', () => {
        const hunk = firstHunk(['@@ -10,2 +10,3 @@', ' keep', '-old', '+new', '+more']);
        expect(formatHunkForAgent('src/cart.ts', hunk)).toBe(
            ['src/cart.ts:10-12', '```diff', ' keep', '-old', '+new', '+more', '```'].join('\n'),
        );
    });

    it('points a removal-only hunk at the old lines', () => {
        const removed = firstHunk(['@@ -4,2 +3,0 @@', '-a', '-b']);
        const single = firstHunk(['@@ -1 +1 @@', '-a', '+b']);
        expect(hunkLocation('a.ts', removed)).toBe('a.ts:4-5 (removed lines)');
        expect(hunkLocation('a.ts', single)).toBe('a.ts:1');
    });

    it('lengthens the fence past backticks in the code', () => {
        const hunk = firstHunk(['@@ -1 +1 @@', '+const md = "```js";']);
        const text = formatHunkForAgent('a.ts', hunk);
        expect(text.split('\n')[1]).toBe('````diff');
        expect(text.endsWith('\n````')).toBe(true);
    });

    it('joins every hunk of a file', () => {
        const hunks = hunksOf(['@@ -1 +1 @@', '+a', '@@ -9 +9 @@', '+b']);
        expect(formatFileForAgent('x.ts', hunks)).toBe(
            ['x.ts:1', '```diff', '+a', '```', '', 'x.ts:9', '```diff', '+b', '```'].join('\n'),
        );
    });
});
