import type { DiffHunk, DiffLine } from './diff-parser';

/** The lines of context git puts around a change by default (`-U3`). */
const CONTEXT = 3;

/** A file as the whole-file view shows it: every line, and its changes as the Changes view's. */
export interface WholeFile {
    /** Every line of the file, the removed ones where they were. */
    lines: DiffLine[];
    /** The changes, each with three lines of context, as git's own hunks. */
    hunks: DiffHunk[];
    /** Per line, the index of the hunk it belongs to, or -1 outside them. */
    hunkOf: Int32Array;
    /** Per hunk, the index of its first line in `lines`. */
    starts: number[];
}

const isChange = (line: DiffLine) => line.kind === 'add' || line.kind === 'del';

function range(start: number, count: number): string {
    return count === 1 ? `${start}` : `${start},${count}`;
}

/**
 * The hunk of `lines[from..to]`, numbered as git numbers it: a side with no line starts at the
 * line before (0 at the top of the file).
 */
function cutHunk(lines: readonly DiffLine[], from: number, to: number): DiffHunk {
    const body = lines.slice(from, to + 1).map((line, id) => ({ ...line, id }));
    const side = (number: (line: DiffLine) => number | null) => {
        const numbers = body.map(number).filter((n) => n !== null);
        if (numbers.length > 0) return { start: numbers[0] ?? 0, count: numbers.length };
        const before = lines
            .slice(0, from)
            .map(number)
            .findLast((n) => n !== null);
        return { start: before ?? 0, count: 0 };
    };
    const old = side((line) => line.oldNumber);
    const now = side((line) => line.newNumber);
    return {
        header: `@@ -${range(old.start, old.count)} +${range(now.start, now.count)} @@`,
        oldStart: old.start,
        oldLines: old.count,
        newStart: now.start,
        newLines: now.count,
        section: '',
        lines: body,
    };
}

/** The index of the first change at or after `from`; the lines' length when there is none. */
function nextChange(lines: readonly DiffLine[], from: number): number {
    let index = from;
    while (index < lines.length && !isChange(lines[index] as DiffLine)) index += 1;
    return index;
}

function contextLines(lines: readonly DiffLine[], from: number, to: number): number {
    let count = 0;
    for (let index = from; index < to; index += 1) {
        if (lines[index]?.kind === 'context') count += 1;
    }
    return count;
}

/** The last of the changes from `first` on that at most six unchanged lines separate. */
function lastJoined(lines: readonly DiffLine[], first: number): number {
    let last = first;
    for (;;) {
        const next = nextChange(lines, last + 1);
        if (next >= lines.length || contextLines(lines, last + 1, next) > 2 * CONTEXT) return last;
        last = next;
    }
}

/** Where the hunk of the change at `first` starts: three unchanged lines before it. */
function hunkStart(lines: readonly DiffLine[], first: number): number {
    let from = first;
    for (let context = 0; from > 0 && context < CONTEXT; ) {
        from -= 1;
        if (lines[from]?.kind === 'context') context += 1;
    }
    return from;
}

/**
 * Where the hunk of the change at `last` ends: three unchanged lines after it, and a note (no
 * newline at the end) stays with its line.
 */
function hunkEnd(lines: readonly DiffLine[], last: number): number {
    let to = last;
    for (let context = 0; to + 1 < lines.length; ) {
        const next = lines[to + 1] as DiffLine;
        if (next.kind !== 'note' && context === CONTEXT) break;
        to += 1;
        if (next.kind === 'context') context += 1;
    }
    return to;
}

/**
 * The whole file from its diff with every line as context (`wholeFile` requests), and its changes
 * cut into hunks as git cuts them with three lines of context: changes at most six unchanged
 * lines apart share a hunk. The hunks are git's own, but for the function name after `@@`,
 * which git finds with the file type's rules: checked against git on 1,370 files of this
 * repository's and a large Rust repository's history.
 */
export function wholeFile(hunks: readonly DiffHunk[]): WholeFile {
    // every line in one hunk; none for a file with no line changes
    const lines = hunks.flatMap((hunk) => hunk.lines);
    const hunkOfLine = new Int32Array(lines.length).fill(-1);
    const found: DiffHunk[] = [];
    const starts: number[] = [];

    let first = nextChange(lines, 0);
    while (first < lines.length) {
        const last = lastJoined(lines, first);
        const from = hunkStart(lines, first);
        const to = hunkEnd(lines, last);
        hunkOfLine.fill(found.length, from, to + 1);
        starts.push(from);
        found.push(cutHunk(lines, from, to));
        first = nextChange(lines, last + 1);
    }

    return { lines, hunks: found, hunkOf: hunkOfLine, starts };
}
