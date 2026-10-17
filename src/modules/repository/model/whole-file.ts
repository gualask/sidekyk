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

/**
 * The whole file from its diff with every line as context (`wholeFile` requests), and its changes
 * cut into hunks as git cuts them with three lines of context: changes at most six unchanged
 * lines apart share a hunk. The hunks are git's own, but for the function name after `@@`,
 * which git finds with the file type's rules: checked against git on 1,370 files of this
 * repository's and Zed's history.
 */
export function wholeFile(hunks: readonly DiffHunk[]): WholeFile {
    // every line in one hunk; none for a file with no line changes
    const lines = hunks.flatMap((hunk) => hunk.lines);
    const hunkOfLine = new Int32Array(lines.length).fill(-1);
    const found: DiffHunk[] = [];
    const starts: number[] = [];

    let index = 0;
    while (index < lines.length) {
        while (index < lines.length && !isChange(lines[index] as DiffLine)) index += 1;
        if (index >= lines.length) break;
        // the next changes join while at most six unchanged lines separate them
        let last = index;
        for (;;) {
            let next = last + 1;
            let unchanged = 0;
            while (next < lines.length && !isChange(lines[next] as DiffLine)) {
                if (lines[next]?.kind === 'context') unchanged += 1;
                next += 1;
            }
            if (next >= lines.length || unchanged > 2 * CONTEXT) break;
            last = next;
        }
        // three unchanged lines on each side; a note (no newline at the end) stays with its line
        let from = index;
        for (let context = 0; from > 0 && context < CONTEXT; ) {
            from -= 1;
            if (lines[from]?.kind === 'context') context += 1;
        }
        let to = last;
        for (let context = 0; to + 1 < lines.length; ) {
            const next = lines[to + 1] as DiffLine;
            if (next.kind !== 'note' && context === CONTEXT) break;
            to += 1;
            if (next.kind === 'context') context += 1;
        }
        hunkOfLine.fill(found.length, from, to + 1);
        starts.push(from);
        found.push(cutHunk(lines, from, to));
        index = last + 1;
    }

    return { lines, hunks: found, hunkOf: hunkOfLine, starts };
}
