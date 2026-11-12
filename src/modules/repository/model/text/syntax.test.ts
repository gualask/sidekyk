import { describe, expect, it } from 'vitest';
import type { DiffLine } from '../diff/diff-parser';
import { changeSides } from '../diff/sides';
import type { SyntaxColors } from '../repository.types';
import { blockKey, blocksOf, lineCheck, lineColors, textParts } from './syntax';

function line(
    kind: DiffLine['kind'],
    oldNumber: number | null,
    newNumber: number | null,
    text = '',
) {
    return { id: 0, kind, text, oldNumber, newNumber } satisfies DiffLine;
}

describe('lineCheck', () => {
    it('hashes as the backend does', () => {
        // the same values as `line_checks_match_the_frontend` in `syntax/coloring/mod.rs`
        expect(lineCheck('')).toBe(0x811c9dc5);
        expect(lineCheck('fn main() {}')).toBe(0x9f731f0f);
        expect(lineCheck('é→😀')).toBe(0x7ab3ca77);
    });
});

describe('blocksOf and lineColors', () => {
    it('group lines in blocks of 256, each once, on the sides there are', () => {
        const sides = changeSides({ path: 'a.ts', origPath: null, area: 'untracked' });
        const lines = [line('add', null, 2), line('add', null, 300), line('del', 5, null)];
        expect(
            blocksOf([...lines, line('add', null, 256), line('note', null, null)], sides),
        ).toEqual([
            { side: 'new', first: 1 },
            { side: 'new', first: 257 },
        ]);
    });

    it('color a line from its side while its text is the one colored', () => {
        const colors = (text: string, tone: 'keyword' | 'string'): SyntaxColors => ({
            tooLarge: false,
            lines: [{ check: lineCheck(text), spans: [[0, 3, tone]] }],
        });
        const read = new Map([
            [blockKey({ side: 'new', first: 257 }), colors('let b', 'keyword')],
            [blockKey({ side: 'old', first: 1 }), colors('old a', 'string')],
        ]);
        expect(lineColors(read, line('context', 1, 257, 'let b'))).toEqual([[0, 3, 'keyword']]);
        expect(lineColors(read, line('del', 1, null, 'old a'))).toEqual([[0, 3, 'string']]);
        expect(lineColors(read, line('add', null, 257, 'changed'))).toBeUndefined();
        expect(lineColors(read, line('add', null, 2, 'let b'))).toBeUndefined();
        expect(lineColors(read, line('note', null, null))).toBeUndefined();
    });
});

describe('textParts', () => {
    it('cuts a line where colors and matches start and end', () => {
        expect(
            textParts(
                'let total = 1;',
                [
                    [0, 3, 'keyword'],
                    [12, 13, 'literal'],
                ],
                [[2, 9]],
            ),
        ).toEqual([
            { text: 'le', tone: 'keyword', found: null, breakBefore: false },
            { text: 't', tone: 'keyword', found: 0, breakBefore: false },
            { text: ' total', tone: null, found: 0, breakBefore: false },
            { text: ' = ', tone: null, found: null, breakBefore: false },
            { text: '1', tone: 'literal', found: null, breakBefore: false },
            { text: ';', tone: null, found: null, breakBefore: false },
        ]);
    });

    it('cuts a wrapped line where its rows start too', () => {
        expect(textParts('let total = 1;', [[0, 3, 'keyword']], [], [6, 12])).toEqual([
            { text: 'let', tone: 'keyword', found: null, breakBefore: false },
            { text: ' to', tone: null, found: null, breakBefore: false },
            { text: 'tal = ', tone: null, found: null, breakBefore: true },
            { text: '1;', tone: null, found: null, breakBefore: true },
        ]);
    });

    it('keeps a line without colors or matches whole', () => {
        expect(textParts('plain', [], [])).toEqual([
            { text: 'plain', tone: null, found: null, breakBefore: false },
        ]);
        expect(textParts('', [], [])).toEqual([]);
    });
});
