import { describe, expect, it } from 'vitest';
import { DEFAULT_COPY_TEMPLATE } from '@/shared/copy/copy-template';
import { createTranslator } from '@/shared/i18n';
import {
    type CopySource,
    copiedLabel,
    copiedText,
    fileText,
    hunkCopied,
    lineCopied,
    selectionCopied,
} from './copied';
import { parseUnifiedDiff } from './diff-parser';

function hunksOf(lines: string[]) {
    return parseUnifiedDiff(lines.join('\n')).hunks;
}

function firstHunk(lines: string[]) {
    const [hunk] = hunksOf(lines);
    if (!hunk) throw new Error('fixture has no hunk');
    return hunk;
}

const en = createTranslator('en', 'en');

const tree = (path: string): CopySource => ({ path, origPath: null, commit: null });

describe('copied', () => {
    const hunk = firstHunk(['@@ -10,3 +10,3 @@', ' keep', '-old', '+new', '+more']);
    const [keep, old, added] = hunk.lines;

    it('copies a hunk with its signs, where it sits on the new side', () => {
        expect(hunkCopied(tree('src/cart.ts'), hunk, en)).toEqual({
            row: 'src/cart.ts:10-12',
            text: ' keep\n-old\n+new\n+more',
            lines: '10-12',
        });
        const removed = firstHunk(['@@ -4,2 +3,0 @@', '-a', '-b']);
        expect(hunkCopied(tree('a.ts'), removed, en).row).toBe('a.ts:4-5 (removed)');
    });

    it('copies a line as it is in the file', () => {
        expect(keep && lineCopied(tree('a.ts'), keep, en)).toEqual({
            row: 'a.ts:10',
            text: 'keep',
            lines: '10',
        });
        expect(added && lineCopied(tree('a.ts'), added, en).row).toBe('a.ts:11');
        expect(old && lineCopied(tree('a.ts'), old, en).row).toBe('a.ts:11 (removed)');
    });

    it('names the commit, and the path a removed line had before a rename', () => {
        const renamed: CopySource = {
            path: 'src/new.ts',
            origPath: 'src/old.ts',
            commit: 'a1b2c3d',
        };
        expect(added && lineCopied(renamed, added, en).row).toBe('src/new.ts:11 (a1b2c3d)');
        expect(old && lineCopied(renamed, old, en).row).toBe('src/old.ts:11 (removed in a1b2c3d)');
        const inTree: CopySource = { ...renamed, commit: null };
        expect(old && lineCopied(inTree, old, en).row).toBe('src/old.ts:11 (removed)');
        const italian = createTranslator('it', 'it');
        expect(old && lineCopied(renamed, old, italian).row).toBe(
            'src/old.ts:11 (rimosso in a1b2c3d)',
        );
    });

    it('copies a selection exactly, with the lines it spans', () => {
        const lines = hunk.lines.slice(0, 3);
        expect(selectionCopied(tree('a.ts'), lines, 'ep\nold\nne', en)).toEqual({
            row: 'a.ts:10-11',
            text: 'ep\nold\nne',
            lines: '10-11',
        });
        expect(selectionCopied(tree('a.ts'), [], 'x', en).row).toBe('a.ts');
    });

    it('names what it took for its confirmation', () => {
        expect(copiedLabel(hunkCopied(tree('a.ts'), hunk, en), en)).toBe('Copied lines 10–12');
        expect(keep && copiedLabel(lineCopied(tree('a.ts'), keep, en), en)).toBe('Copied line 10');
    });

    it('goes through the template, a file hunk by hunk', () => {
        expect(copiedText(DEFAULT_COPY_TEMPLATE, { row: 'a.ts:1', text: 'x', lines: '1' })).toBe(
            'a.ts:1\nx',
        );
        const hunks = hunksOf(['@@ -1 +1 @@', '+a', '@@ -9 +9 @@', '+b']);
        expect(fileText('{row} {text}', tree('x.ts'), hunks, en)).toBe('x.ts:1 +a\n\nx.ts:9 +b');
    });
});
