/**
 * Soft wrap of a line of code at a width in columns, a column being an ASCII character's advance
 * in the viewer's monospace font. The breaks are chosen here, not by the browser, so every line's
 * height is known before it renders: the virtualized list places the rows of a whole file without
 * measuring them. As Zed wraps: a line breaks before a word that follows a
 * space, or before a character that is not part of a word; a word longer than the row breaks where
 * the row ends. Spaces never start a row: they hang past its edge, as CSS's `pre-wrap` lets them;
 * nor does a character drawn with the one before it (an accent, a skin tone, what a joiner joins).
 * The rows after the first start at the line's indentation, while it takes at most half the row.
 */

import {
    ASCII_WORD,
    advance,
    type GlyphWidth,
    isPrintableAscii,
    isSpace,
    isWordChar,
    joinsPrevious,
    ONE_COLUMN,
} from './glyphs';

/**
 * The indentation of the rows after the first, in columns: the line's own, or none when it takes
 * more than half the row or the line is only spaces.
 */
export function wrapIndent(text: string, columns: number): number {
    let x = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (!isSpace(code)) return x * 2 <= columns ? x : 0;
        x += advance(code, code, x, ONE_COLUMN);
    }
    return 0;
}

/** Any line: one character at a time, back to the last break when a row is full. */
function wrapAny(
    text: string,
    columns: number,
    widthOf: GlyphWidth,
    indent: number,
    breaks: number[] | null,
): number {
    let rows = 1;
    let rowStart = 0;
    let x = 0;
    let seen = false;
    let candidate = -1;
    let afterSpace = false;
    let previous = 0;
    let i = 0;
    while (i < text.length) {
        const code = text.charCodeAt(i);
        if (isSpace(code)) {
            x += advance(code, code, x, widthOf);
            afterSpace = true;
            previous = code;
            i++;
            continue;
        }
        const point = text.codePointAt(i) ?? code;
        const joins = joinsPrevious(point, previous);
        // the line's first character is no break: the indentation stays with it
        if (!seen) seen = true;
        else if (i > rowStart && !joins && (afterSpace || !isWordChar(point))) candidate = i;
        const width = advance(code, point, x, widthOf);
        if (x + width > columns && i > rowStart && !joins) {
            const at = candidate > rowStart ? candidate : i;
            breaks?.push(at);
            rows++;
            // what moved to the new row is counted again from its start
            rowStart = at;
            i = at;
            x = indent;
            candidate = -1;
            afterSpace = false;
            previous = 0;
            continue;
        }
        x += width;
        afterSpace = false;
        previous = point;
        i += point > 0xffff ? 2 : 1;
    }
    return rows;
}

/**
 * A line of printable ASCII, most code: every character one column, so each row looks once at
 * where it ends and back to its last break, instead of at every character. The same breaks as
 * `wrapAny`.
 */
function wrapAscii(text: string, columns: number, indent: number, breaks: number[] | null): number {
    const n = text.length;
    if (n <= columns) return 1;
    let first = 0;
    while (first < n && text.charCodeAt(first) === 32) first++;
    let rows = 1;
    let start = 0;
    let x = 0;
    for (;;) {
        // the first character past the row's end that is not a space
        let end = Math.max(start + 1, start + columns - x);
        while (end < n && text.charCodeAt(end) === 32) end++;
        if (end >= n) return rows;
        const at = asciiBreak(text, start, first, end);
        breaks?.push(at);
        rows++;
        start = at;
        x = indent;
    }
}

/**
 * Where a row from `start` breaks before `end`: at the last character that follows a space or
 * is not a word's, past the indentation that ends at `first`; at `end` when there is none.
 */
function asciiBreak(text: string, start: number, first: number, end: number): number {
    for (let j = end; j > start && j > first; j--) {
        const code = text.charCodeAt(j);
        if (code !== 32 && (text.charCodeAt(j - 1) === 32 || !ASCII_WORD[code])) return j;
    }
    return end;
}

/**
 * The rows a line takes at `columns`, and, into `breaks`, where each row after the first starts
 * (UTF-16 offsets). `ascii`: whether the line is printable ASCII alone, if already known.
 */
export function softWrap(
    text: string,
    columns: number,
    widthOf: GlyphWidth,
    breaks: number[] | null = null,
    ascii = isPrintableAscii(text),
): number {
    const indent = wrapIndent(text, columns);
    return ascii
        ? wrapAscii(text, columns, indent, breaks)
        : wrapAny(text, columns, widthOf, indent, breaks);
}

/** Where a line breaks, and the indentation of its rows after the first. */
export interface LineBreaks {
    breaks: readonly number[];
    indent: number;
}

/** A line that fits: the same for all, so a row shown again with it is the same row. */
const NO_BREAKS: LineBreaks = Object.freeze({ breaks: Object.freeze([]), indent: 0 });

export function lineBreaks(
    text: string,
    columns: number,
    widthOf: GlyphWidth,
    ascii = isPrintableAscii(text),
): LineBreaks {
    const breaks: number[] = [];
    softWrap(text, columns, widthOf, breaks, ascii);
    return breaks.length > 0 ? { breaks, indent: wrapIndent(text, columns) } : NO_BREAKS;
}

/**
 * What wrapping needs of a text's lines once, whatever the width: each one's width on one row, in
 * columns, and whether it is printable ASCII alone.
 */
interface LineMeasures {
    widths: Float64Array;
    ascii: Uint8Array;
}

export function measureLines(texts: readonly string[], widthOf: GlyphWidth): LineMeasures {
    const widths = new Float64Array(texts.length);
    const ascii = new Uint8Array(texts.length);
    texts.forEach((text, index) => {
        // `lineWidth` and `isPrintableAscii` in one pass: every line of the text goes through it
        let x = 0;
        let plain = 1;
        for (let i = 0; i < text.length; i++) {
            const code = text.charCodeAt(i);
            if (code >= 0x20 && code < 0x7f) {
                x += 1;
                continue;
            }
            plain = 0;
            const point = code >= 0xd800 && code <= 0xdbff ? (text.codePointAt(i) ?? code) : code;
            x += advance(code, point, x, widthOf);
            if (point > 0xffff) i++;
        }
        widths[index] = x;
        ascii[index] = plain;
    });
    return { widths, ascii };
}

/**
 * The lines of a text wrapped at `columns`, the one source of how many rows each takes (for the
 * layout) and where it breaks (for the rows on screen, worked out once each). A line that fits
 * takes one row, never looked at again: no break can come before its end.
 */
export interface LineWrapper {
    rowsOf: (index: number) => number;
    breaksOf: (index: number) => LineBreaks;
}

export function lineWrapper(
    texts: readonly string[],
    measures: LineMeasures,
    columns: number,
    widthOf: GlyphWidth,
): LineWrapper {
    const fits = (index: number) => (measures.widths[index] ?? 0) <= columns;
    const known = new Map<number, LineBreaks>();
    return {
        rowsOf: (index) =>
            fits(index)
                ? 1
                : softWrap(texts[index] ?? '', columns, widthOf, null, measures.ascii[index] === 1),
        breaksOf: (index) => {
            if (fits(index)) return NO_BREAKS;
            let found = known.get(index);
            if (!found) {
                const text = texts[index] ?? '';
                found = lineBreaks(text, columns, widthOf, measures.ascii[index] === 1);
                known.set(index, found);
            }
            return found;
        },
    };
}
