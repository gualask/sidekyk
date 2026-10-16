import { describe, expect, it } from 'vitest';
import { hunkCopied } from './copied';
import { parseUnifiedDiff } from './diff-parser';
import { wholeFile } from './whole-file';

const SOURCE = { path: 'a.txt', origPath: null, commit: null };
const parse = (lines: string[]) => parseUnifiedDiff(`${lines.join('\n')}\n`).hunks;
/** A hunk without the function name git adds after its header. */
const withoutSection = (hunk: ReturnType<typeof parse>[number]) => ({
    ...hunk,
    header: hunk.header.replace(/ @@ .*$/, ' @@'),
    section: '',
});

// `git diff --no-index` of a 30-line file, with every line as context and with git's three: a
// change near the top, changes six and seven unchanged lines apart, a removed line, and a last
// line with no newline at the end
const WHOLE = [
    '@@ -1,30 +1,29 @@',
    ' l1',
    '-l2',
    '+L2',
    ...[3, 4, 5, 6, 7, 8].map((n) => ` l${n}`),
    '-l9',
    '+L9',
    ...[10, 11, 12, 13, 14, 15, 16].map((n) => ` l${n}`),
    '-l17',
    '+X17',
    ...[18, 19, 20, 21, 22].map((n) => ` l${n}`),
    '-l23',
    ...[24, 25, 26, 27, 28, 29].map((n) => ` l${n}`),
    '-l30',
    '+l30 end',
    '\\ No newline at end of file',
];
const GIT_HUNKS = [
    '@@ -1,12 +1,12 @@',
    ' l1',
    '-l2',
    '+L2',
    ...[3, 4, 5, 6, 7, 8].map((n) => ` l${n}`),
    '-l9',
    '+L9',
    ' l10',
    ' l11',
    ' l12',
    '@@ -14,17 +14,16 @@ l13',
    ' l14',
    ' l15',
    ' l16',
    '-l17',
    '+X17',
    ...[18, 19, 20, 21, 22].map((n) => ` l${n}`),
    '-l23',
    ...[24, 25, 26, 27, 28, 29].map((n) => ` l${n}`),
    '-l30',
    '+l30 end',
    '\\ No newline at end of file',
];

describe('wholeFile', () => {
    it("cuts the changes into git's own hunks", () => {
        const file = wholeFile(parse(WHOLE));
        expect(file.hunks).toEqual(parse(GIT_HUNKS).map(withoutSection));
        expect(file.lines).toHaveLength(WHOLE.length - 1);
        expect(file.starts).toEqual([0, 15]);
    });

    it('knows the hunk of every line', () => {
        const file = wholeFile(parse(WHOLE));
        const hunkOf = (text: string) =>
            file.hunkOf[file.lines.findIndex((line) => line.text === text)];
        expect(hunkOf('l1')).toBe(0);
        expect(hunkOf('l12')).toBe(0);
        expect(hunkOf('l13')).toBe(-1);
        expect(hunkOf('l14')).toBe(1);
        expect(hunkOf('\\ No newline at end of file')).toBe(1);
    });

    it('copies a hunk as the Changes view does', () => {
        const [derived] = wholeFile(parse(WHOLE)).hunks;
        const [git] = parse(GIT_HUNKS);
        expect(derived && hunkCopied(SOURCE, derived)).toEqual(git && hunkCopied(SOURCE, git));
    });

    it('numbers a side with no line from the line before', () => {
        const added = wholeFile(parse(['@@ -0,0 +1,2 @@', '+a', '+b']));
        expect(added.hunks.map((h) => h.header)).toEqual(['@@ -0,0 +1,2 @@']);

        const removed = wholeFile(parse(['@@ -1,3 +0,0 @@', '-a', '-b', '-c']));
        expect(removed.hunks.map((h) => h.header)).toEqual(['@@ -1,3 +0,0 @@']);

        const lines = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
        const middle = wholeFile(
            parse(['@@ -1,8 +1,7 @@', ...lines.map((l) => (l === 'e' ? `-${l}` : ` ${l}`))]),
        );
        expect(middle.hunks.map((h) => h.header)).toEqual(['@@ -2,7 +2,6 @@']);
    });

    it('has no hunk for a file without line changes', () => {
        expect(wholeFile([])).toMatchObject({ lines: [], hunks: [], starts: [] });
        const unchanged = wholeFile(parse(['@@ -1,2 +1,2 @@', ' a', ' b']));
        expect(unchanged.hunks).toEqual([]);
        expect([...unchanged.hunkOf]).toEqual([-1, -1]);
    });
});
