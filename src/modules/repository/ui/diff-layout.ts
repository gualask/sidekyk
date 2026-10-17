import type { DiffRow } from '../model/diff-rows';

/** Fixed heights, so the virtualized diff knows every row's place without measuring it. */
export const HUNK_ROW_HEIGHT = 24;
export const LINE_ROW_HEIGHT = 20;

/** A line's parts, in pixels, left to right: `DiffLineRow` lays them out with these. */
export const BRACKET_WIDTH = 16;
export const NUMBER_WIDTH = 56;
export const SIGN_WIDTH = 20;
export const TEXT_PADDING_LEFT = 4;
export const TEXT_PADDING_RIGHT = 24;
/** How far the find bar floats from the viewer's top and right edges, and its height. */
export const FIND_BAR_INSET = 8;
export const FIND_BAR_HEIGHT = 34;
/** The room the viewer leaves above its rows while the find bar floats over them. */
export const FIND_BAR_SPACE = FIND_BAR_INSET + FIND_BAR_HEIGHT + FIND_BAR_INSET;

/** The gutter and padding around a line's text. */
export const LINE_CHROME_WIDTH =
    BRACKET_WIDTH + NUMBER_WIDTH + SIGN_WIDTH + TEXT_PADDING_LEFT + TEXT_PADDING_RIGHT;

export function rowHeight(row: DiffRow | undefined): number {
    return row?.kind === 'hunk' ? HUNK_ROW_HEIGHT : LINE_ROW_HEIGHT;
}

/** Rows `first` to `last` of the list. */
export interface Span {
    first: number;
    last: number;
}

/** Where each row of a diff starts, and the rows of each hunk, from the rows' fixed heights. */
export interface DiffLayout {
    starts: readonly number[];
    /** Per hunk, in order, its rows: its header, if any, and its lines. */
    hunks: readonly Span[];
    /** The hunks' first and last rows apart, for binary searches on scroll. */
    hunkFirsts: readonly number[];
    hunkLasts: readonly number[];
    total: number;
}

export function diffLayout(rows: readonly DiffRow[]): DiffLayout {
    const starts: number[] = [];
    const hunks: Span[] = [];
    let offset = 0;
    rows.forEach((row, index) => {
        starts.push(offset);
        offset += rowHeight(row);
        if (row.hunkIndex < 0) return;
        const span = hunks[row.hunkIndex];
        if (span) span.last = index;
        else hunks[row.hunkIndex] = { first: index, last: index };
    });
    return {
        starts,
        hunks,
        hunkFirsts: hunks.map((span) => span.first),
        hunkLasts: hunks.map((span) => span.last),
        total: offset,
    };
}

/** Where rows `first` to `last` are in the list. */
export function spanBox(
    { starts }: DiffLayout,
    rows: readonly DiffRow[],
    { first, last }: Span,
): { top: number; height: number } {
    const top = starts[first] ?? 0;
    return { top, height: (starts[last] ?? top) + rowHeight(rows[last]) - top };
}

/** The first index whose value is past `value`, in values that only grow. */
function firstPast(values: readonly number[], value: number): number {
    let low = 0;
    let high = values.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if ((values[middle] ?? 0) > value) high = middle;
        else low = middle + 1;
    }
    return low;
}

/** The row at `offset` from the top of the list. */
export function rowAt({ starts }: DiffLayout, offset: number): number {
    return Math.max(0, firstPast(starts, offset) - 1);
}

/** Whether row `row` shows whole between offsets `top` and `bottom` of the list. */
export function rowWithin(
    layout: DiffLayout,
    rows: readonly DiffRow[],
    row: number,
    top: number,
    bottom: number,
): boolean {
    const start = layout.starts[row] ?? 0;
    return start >= top && start + rowHeight(rows[row]) <= bottom;
}

/**
 * The hunks with a line among rows `from` to `to`, each with its lines only (in the Changes view
 * a hunk starts with its header): those the gutter marks on screen.
 */
export function hunksBetween(
    layout: DiffLayout,
    rows: readonly DiffRow[],
    from: number,
    to: number,
): { hunk: number; lines: Span }[] {
    const found: { hunk: number; lines: Span }[] = [];
    for (let hunk = firstPast(layout.hunkLasts, from - 1); hunk < layout.hunks.length; hunk++) {
        const span = layout.hunks[hunk];
        if (!span || span.first > to) break;
        const first = rows[span.first]?.kind === 'hunk' ? span.first + 1 : span.first;
        if (first <= span.last) found.push({ hunk, lines: { first, last: span.last } });
    }
    return found;
}

/** Where the list opens on hunk `hunk` (the first if null), `linesAbove` lines above it. */
export function openingOffset(layout: DiffLayout, hunk: number | null, linesAbove: number): number {
    // a hunk counted from the end (-1, the last): `p` goes into a file from its bottom
    const index = hunk === null ? 0 : hunk < 0 ? layout.hunks.length + hunk : hunk;
    const span = layout.hunks[index];
    if (!span) return 0;
    return Math.max(0, (layout.starts[span.first] ?? 0) - linesAbove * LINE_ROW_HEIGHT);
}

/** The hunk at row `row`, or the next one below it, or the last: the change being read there. */
export function hunkFrom(layout: DiffLayout, rows: readonly DiffRow[], row: number): number {
    const at = rows[row]?.hunkIndex ?? -1;
    if (at >= 0) return at;
    return Math.min(firstPast(layout.hunkFirsts, row), layout.hunks.length - 1);
}

/**
 * The hunk `n` (`step` 1) or `p` (-1) goes to from the line being read, at offset `reading`, when
 * none was gone to yet: the first starting on it or below (a file just opened: its first change,
 * marked), or the last starting above it; null when there is none that way.
 */
export function hunkStepped(layout: DiffLayout, reading: number, step: 1 | -1): number | null {
    const starts = layout.hunks.map((span) => layout.starts[span.first] ?? 0);
    if (step > 0) {
        const next = starts.findIndex((start) => start >= reading - 1);
        return next < 0 ? null : next;
    }
    const previous = starts.findLastIndex((start) => start < reading - 1);
    return previous < 0 ? null : previous;
}
