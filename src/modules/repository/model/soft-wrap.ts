/**
 * Soft wrap of a line of code at a width in columns, a column being an ASCII character's advance
 * in the viewer's monospace font. The breaks are chosen here, not by the browser, so every line's
 * height is known before it renders: the virtualized list places the rows of a whole file without
 * measuring them. As Zed does (GPUI's `LineWrapper`): a line breaks before a word that follows a
 * space, or before a character that is not part of a word; a word longer than the row breaks where
 * the row ends. Spaces never start a row: they hang past its edge, as CSS's `pre-wrap` lets them;
 * nor does a character drawn with the one before it (an accent, a skin tone, what a joiner joins).
 * The rows after the first start at the line's indentation, while it takes at most half the row.
 */

/** Columns between tab stops: the browser's default `tab-size`. */
export const TAB_SIZE = 8;

/** A character's advance in columns: 1 for ASCII, measured for the rest (CJK about 1.5). */
export type GlyphWidth = (codePoint: number) => number;

const ONE_COLUMN: GlyphWidth = () => 1;

/**
 * Characters that belong to a word, as in Zed: letters and digits, Latin and Cyrillic ones, and
 * the marks a word keeps (`a-b`, `var_name`, `I'm`, `@mention`, `#tag`, `100%`, `3.14`).
 */
function isWordChar(code: number): boolean {
    return (
        (code >= 48 && code <= 57) ||
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        code === 95 ||
        code === 45 ||
        code === 39 ||
        code === 64 ||
        code === 35 ||
        code === 37 ||
        code === 46 ||
        code === 0x2019 ||
        (code >= 0xc0 && code <= 0x24f) ||
        (code >= 0x300 && code <= 0x36f) ||
        (code >= 0x400 && code <= 0x4ff) ||
        (code >= 0x1e00 && code <= 0x1eff)
    );
}

const ASCII_WORD = Uint8Array.from({ length: 128 }, (_, code) => (isWordChar(code) ? 1 : 0));

const ZERO_WIDTH_JOINER = 0x200d;
const COMBINING_MARK = /\p{M}/u;
/** What the test for a combining mark said of each character it was asked about. */
const markOf = new Map<number, boolean>();

function isCombiningMark(point: number): boolean {
    let mark = markOf.get(point);
    if (mark === undefined) {
        mark = COMBINING_MARK.test(String.fromCodePoint(point));
        markOf.set(point, mark);
    }
    return mark;
}

/**
 * Whether a character is drawn with the one before it, so no row starts with it: a combining mark,
 * a variation selector, an emoji's skin tone or tag, the second of a pair of regional indicators
 * (a flag), a joiner and what it joins.
 */
function joinsPrevious(point: number, previous: number): boolean {
    if (previous === ZERO_WIDTH_JOINER) return true;
    if (point < 0x300) return false;
    if (point <= 0x36f || point === ZERO_WIDTH_JOINER) return true;
    if ((point >= 0xfe00 && point <= 0xfe0f) || (point >= 0x1f3fb && point <= 0x1f3ff)) return true;
    if ((point >= 0xe0020 && point <= 0xe007f) || (point >= 0xe0100 && point <= 0xe01ef)) {
        return true;
    }
    if (point >= 0x1f1e6 && point <= 0x1f1ff) return previous >= 0x1f1e6 && previous <= 0x1f1ff;
    // CJK and Hangul, most of what is not ASCII in code, are no marks
    if ((point >= 0x4e00 && point <= 0x9fff) || (point >= 0xac00 && point <= 0xd7a3)) return false;
    return isCombiningMark(point);
}

/** Spaces hang past a row's edge: a tab, a space, and the carriage return of a CRLF line. */
function isSpace(code: number): boolean {
    return code === 32 || code === 9 || code === 13;
}

function isPrintableAscii(text: string): boolean {
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code < 0x20 || code >= 0x7f) return false;
    }
    return true;
}

/**
 * How far a character at column `x` moves on: a tab to the next stop, a space, a carriage return
 * and printable ASCII one column, anything else as measured. `point` is its code point.
 */
function advance(code: number, point: number, x: number, widthOf: GlyphWidth): number {
    if (code === 9) return TAB_SIZE - (x % TAB_SIZE);
    if ((code >= 0x20 && code < 0x7f) || code === 13) return 1;
    return widthOf(point);
}

/** A line's width on one row, in columns; with `widthOf` left out, every character takes one. */
export function lineWidth(text: string, widthOf: GlyphWidth = ONE_COLUMN): number {
    let x = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        const point = code >= 0xd800 && code <= 0xdbff ? (text.codePointAt(i) ?? code) : code;
        x += advance(code, point, x, widthOf);
        if (point > 0xffff) i++;
    }
    return x;
}

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
        let at = end;
        for (let j = end; j > start && j > first; j--) {
            const code = text.charCodeAt(j);
            if (code !== 32 && (text.charCodeAt(j - 1) === 32 || !ASCII_WORD[code])) {
                at = j;
                break;
            }
        }
        breaks?.push(at);
        rows++;
        start = at;
        x = indent;
    }
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
