import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff, sameButWhitespace } from './diff-parser';

describe('parseUnifiedDiff', () => {
    it('numbers context, added and deleted lines on each side', () => {
        const diff = [
            'diff --git a/src/cart.ts b/src/cart.ts',
            'index 1111111..2222222 100644',
            '--- a/src/cart.ts',
            '+++ b/src/cart.ts',
            '@@ -10,3 +10,4 @@ export function total() {',
            ' const items = load();',
            '-const total = sum(items);',
            '+const discount = 5;',
            '+const total = sum(items) - discount;',
            ' return total;',
            '',
        ].join('\n');

        const parsed = parseUnifiedDiff(diff);

        expect(parsed.binary).toBe(false);
        expect(parsed.hunks).toHaveLength(1);
        const [hunk] = parsed.hunks;
        expect(hunk).toMatchObject({
            oldStart: 10,
            oldLines: 3,
            newStart: 10,
            newLines: 4,
            section: 'export function total() {',
        });
        expect(hunk?.lines.map(({ id: _id, ...line }) => line)).toEqual([
            { kind: 'context', text: 'const items = load();', oldNumber: 10, newNumber: 10 },
            { kind: 'del', text: 'const total = sum(items);', oldNumber: 11, newNumber: null },
            { kind: 'add', text: 'const discount = 5;', oldNumber: null, newNumber: 11 },
            {
                kind: 'add',
                text: 'const total = sum(items) - discount;',
                oldNumber: null,
                newNumber: 12,
            },
            { kind: 'context', text: 'return total;', oldNumber: 12, newNumber: 13 },
        ]);
    });

    it('reads several hunks, single-line ranges and the no-newline note', () => {
        const diff = [
            '@@ -0,0 +1 @@',
            '+x',
            '\\ No newline at end of file',
            '@@ -5 +6,2 @@',
            '-a',
            '+b',
            '+c',
        ].join('\n');

        const { hunks } = parseUnifiedDiff(diff);

        expect(hunks.map((h) => [h.oldStart, h.oldLines, h.newStart, h.newLines])).toEqual([
            [0, 0, 1, 1],
            [5, 1, 6, 2],
        ]);
        expect(hunks[0]?.lines[1]).toEqual({
            id: 1,
            kind: 'note',
            text: '\\ No newline at end of file',
            oldNumber: null,
            newNumber: null,
        });
    });

    it('flags binary files', () => {
        const diff =
            'diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\n';
        expect(parseUnifiedDiff(diff)).toMatchObject({ binary: true, hunks: [], changedLines: 0 });
    });

    it('keeps an empty diff empty', () => {
        expect(parseUnifiedDiff('')).toEqual({
            binary: false,
            hunks: [],
            changedLines: 0,
            formattingLines: 0,
        });
    });

    it('reads a combined conflict diff with one prefix column per parent', () => {
        const diff = [
            '@@@ -1,2 -1,2 +1,6 @@@',
            '  shared',
            '++<<<<<<< HEAD',
            '+ ours',
            ' +theirs',
        ].join('\n');

        const [hunk] = parseUnifiedDiff(diff).hunks;

        expect(hunk?.newStart).toBe(1);
        expect(hunk?.lines.map((l) => [l.kind, l.text, l.oldNumber, l.newNumber])).toEqual([
            ['context', 'shared', null, 1],
            ['add', '<<<<<<< HEAD', null, 2],
            ['add', 'ours', null, 3],
            ['add', 'theirs', null, 4],
        ]);
    });

    it('marks removed and added lines that differ only in whitespace or line ending', () => {
        const diff = [
            '@@ -1,6 +1,6 @@',
            ' fn total() {',
            '-    let a = 1;',
            '-    let b = 2;',
            '-    a + b',
            '+\tlet a = 1;\r',
            '+\tlet  b=2;',
            '+\ta - b',
            ' }',
            '-tail',
            '+tail',
            '\\ No newline at end of file',
        ].join('\n');

        const parsed = parseUnifiedDiff(diff);

        expect(parsed.changedLines).toBe(8);
        expect(parsed.formattingLines).toBe(6);
        expect(parsed.hunks[0]?.lines.map((l) => [l.kind, l.formatting])).toEqual([
            ['context', undefined],
            ['del', 'lf'],
            ['del', 'lf'],
            ['del', undefined],
            ['add', 'crlf'],
            ['add', 'lf'],
            ['add', undefined],
            ['context', undefined],
            ['del', 'lf'],
            ['add', 'none'],
            ['note', undefined],
        ]);
    });

    it('leaves blocks of unequal counts and combined diffs unpaired', () => {
        const moved = ['@@ -1,2 +1,1 @@', '-a', '-b', '+  a'].join('\n');
        expect(parseUnifiedDiff(moved).formattingLines).toBe(0);
        const combined = ['@@@ -1,1 -1,1 +1,1 @@@', '- a', '+ a '].join('\n');
        expect(parseUnifiedDiff(combined).formattingLines).toBe(0);
    });
});

describe('sameButWhitespace', () => {
    it('compares lines with all their whitespace left out, as git diff -w', () => {
        expect(sameButWhitespace('a b', 'ab')).toBe(true);
        expect(sameButWhitespace('\tx = 1;\r', '    x=1;')).toBe(true);
        expect(sameButWhitespace('  ', '')).toBe(true);
        expect(sameButWhitespace('ab', 'abc')).toBe(false);
        expect(sameButWhitespace('a b', 'a c')).toBe(false);
    });
});
