/**
 * What each character is to a row of code: how far it moves on, whether it belongs to a word, and
 * whether it is drawn with the one before it.
 */

/** Columns between tab stops: the browser's default `tab-size`. */
export const TAB_SIZE = 8;

/** A character's advance in columns: 1 for ASCII, measured for the rest (CJK about 1.5). */
export type GlyphWidth = (codePoint: number) => number;

export const ONE_COLUMN: GlyphWidth = () => 1;

/**
 * Characters that belong to a word, as in Zed: letters and digits, Latin and Cyrillic ones, and
 * the marks a word keeps (`a-b`, `var_name`, `I'm`, `@mention`, `#tag`, `100%`, `3.14`).
 */
export function isWordChar(code: number): boolean {
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

export const ASCII_WORD = Uint8Array.from({ length: 128 }, (_, code) => (isWordChar(code) ? 1 : 0));

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
export function joinsPrevious(point: number, previous: number): boolean {
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
export function isSpace(code: number): boolean {
    return code === 32 || code === 9 || code === 13;
}

export function isPrintableAscii(text: string): boolean {
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
export function advance(code: number, point: number, x: number, widthOf: GlyphWidth): number {
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
