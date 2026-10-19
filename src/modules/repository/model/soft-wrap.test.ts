import { describe, expect, it } from 'vitest';
import {
    type GlyphWidth,
    lineBreaks,
    lineWidth,
    lineWrapper,
    measureLines,
    softWrap,
    wrapIndent,
} from './soft-wrap';

// as in the viewer's font on macOS: CJK about 1.6 columns, emoji 2.3
const widthOf: GlyphWidth = (point) =>
    point >= 0x4e00 && point <= 0x9fff ? 1.6 : point >= 0x1f300 ? 2.3 : 1;

/** The rows a line shows in, cut where it breaks. */
function rows(text: string, columns: number): string[] {
    const { breaks } = lineBreaks(text, columns, widthOf);
    return [0, ...breaks].map((start, index) => text.slice(start, breaks[index]));
}

describe('soft wrap', () => {
    it('breaks before the word that does not fit, its spaces hanging on the row before', () => {
        expect(rows('the quick brown fox', 10)).toEqual(['the quick ', 'brown fox']);
        // a space past the edge does not start a row
        expect(rows('abcdefghij  klm', 10)).toEqual(['abcdefghij  ', 'klm']);
    });

    it('breaks before a character that is not part of a word, else where the row ends', () => {
        expect(rows('call(alpha,beta)', 10)).toEqual(['call(alpha', ',beta)']);
        // a word keeps its dots, dashes and underscores: too long, it is cut at the edge
        expect(rows('some.long_name-here', 8)).toEqual(['some.lon', 'g_name-h', 'ere']);
    });

    it('starts the rows after the first at the indentation, unless it takes half the row', () => {
        const text = '    let total = first + second;';
        expect(rows(text, 16)).toEqual(['    let total = ', 'first + ', 'second;']);
        expect(lineBreaks(text, 16, widthOf).indent).toBe(4);
        expect(wrapIndent(text, 6)).toBe(0);
        expect(wrapIndent('\tx', 20)).toBe(8);
        expect(wrapIndent('    ', 20)).toBe(0);
        // a line that fits needs none
        expect(lineBreaks(text, 80, widthOf)).toEqual({ breaks: [], indent: 0 });
    });

    it('counts wide characters by their width, and may break between them', () => {
        // ten CJK characters take 16 columns: six fit in ten
        expect(rows('中文中文中文中文中文', 10)).toEqual(['中文中文中文', '中文中文']);
        // an emoji is one character of two UTF-16 units: never cut in half
        expect(rows('ab😀😀😀😀', 6)).toEqual(['ab😀', '😀😀', '😀']);
    });

    it('moves on to the next tab stop', () => {
        // the tab takes columns 1 to 7: `b` is at 8, past a row of 8
        expect(rows('a\tbc', 8)).toEqual(['a\t', 'bc']);
    });

    it('measures each line once, and wraps again only the lines wider than the row', () => {
        const texts = ['short', 'the quick brown fox', '中文中文中文中文中文', ''];
        const measures = measureLines(texts, widthOf);
        expect([...measures.widths].map((width) => Math.round(width * 10) / 10)).toEqual([
            5, 19, 16, 0,
        ]);
        expect([...measures.ascii]).toEqual([1, 1, 0, 1]);
        const wrapper = lineWrapper(texts, measures, 10, widthOf);
        expect(texts.map((_, index) => wrapper.rowsOf(index))).toEqual([1, 2, 2, 1]);
        // the rows it counts are the rows it breaks into
        expect(texts.map((_, index) => wrapper.breaksOf(index).breaks.length + 1)).toEqual([
            1, 2, 2, 1,
        ]);
        // the lines that fit share one value, the others are worked out once
        expect(wrapper.breaksOf(0)).toBe(wrapper.breaksOf(3));
        expect(wrapper.breaksOf(1)).toBe(wrapper.breaksOf(1));
    });

    it('never starts a row with a character drawn with the one before it', () => {
        // an accent, a skin tone, what a joiner joins, the second half of a flag
        for (const joined of ['e\u0301', '👍🏽', '👩\u200d💻', '🇮🇹']) {
            // the cluster across the row's end at every place
            for (let before = 10; before <= 16; before++) {
                const text = `${'x'.repeat(before)}${joined}`;
                const breaks = lineBreaks(text, 16, () => 2).breaks;
                expect({ text, inside: breaks.filter((at) => at > before) }).toEqual({
                    text,
                    inside: [],
                });
            }
        }
    });

    it('counts a line the same way for the widest line, a column a character', () => {
        expect(lineWidth('a\tb')).toBe(9);
        expect(lineWidth('中文😀')).toBe(3);
        expect(lineWidth('中文', widthOf)).toBeCloseTo(3.2);
    });

    it('breaks ASCII lines where the character-by-character pass does', () => {
        // a deterministic stream of words, punctuation and runs of spaces
        let seed = 7;
        const next = (n: number) => {
            seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
            return seed % n;
        };
        const alphabet = 'abcdefghij0123456789_.-(){};,=     ';
        for (let line = 0; line < 400; line++) {
            const length = 1 + next(300);
            const indent = ' '.repeat(next(12));
            const text =
                indent + Array.from({ length }, () => alphabet[next(alphabet.length)]).join('');
            for (const columns of [4, 9, 20, 33, 80]) {
                const fast: number[] = [];
                const slow: number[] = [];
                const fastRows = softWrap(text, columns, widthOf, fast, true);
                const slowRows = softWrap(text, columns, widthOf, slow, false);
                expect({ text, columns, breaks: fast, rows: fastRows }).toEqual({
                    text,
                    columns,
                    breaks: slow,
                    rows: slowRows,
                });
            }
        }
    });
});
