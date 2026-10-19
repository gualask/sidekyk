import type { DiffHunk, DiffLine } from './diff-parser';
import { lineWidth, TAB_SIZE } from './soft-wrap';
import type { WholeFile } from './whole-file';

/**
 * The diff as one flat list, so only the rows on screen are rendered: each hunk's header then its
 * lines, or the whole file's lines alone. `hunkIndex` is -1 for a line outside every hunk.
 */
export type DiffRow =
    | { kind: 'hunk'; hunk: DiffHunk; hunkIndex: number }
    | { kind: 'line'; line: DiffLine; hunkIndex: number };

/** The changed lines, under their hunks' headers. */
export function diffRows(hunks: readonly DiffHunk[]): DiffRow[] {
    const rows: DiffRow[] = [];
    hunks.forEach((hunk, hunkIndex) => {
        rows.push({ kind: 'hunk', hunk, hunkIndex });
        for (const line of hunk.lines) rows.push({ kind: 'line', line, hunkIndex });
    });
    return rows;
}

/** Every line of the file, each with its hunk: no header, the hunks are only marked. */
export function wholeFileRows({ lines, hunkOf }: WholeFile): DiffRow[] {
    return lines.map((line, index) => ({ kind: 'line', line, hunkIndex: hunkOf[index] ?? -1 }));
}

/** The widest of these lines, or `widest` if none is wider, in monospace columns. */
function widestOf(lines: readonly DiffLine[], widest = 0): number {
    let found = widest;
    for (const line of lines) {
        // most lines are short: skip the tab-aware count when it cannot win
        if (line.text.length * TAB_SIZE > found) found = Math.max(found, lineWidth(line.text));
    }
    return found;
}

/**
 * The widest line or hunk header, in monospace columns. Rows are positioned absolutely, so the
 * list sets its own width from this instead of growing with its content.
 */
export function widestLine(hunks: readonly DiffHunk[]): number {
    let widest = 0;
    for (const hunk of hunks)
        widest = widestOf(hunk.lines, Math.max(widest, lineWidth(hunk.header)));
    return widest;
}

/** A file's text as lines of a diff that changes none, numbered from 1, for the same viewer. */
export function textLines(text: string): DiffLine[] {
    const lines = text.split('\n');
    if (lines.at(-1) === '') lines.pop();
    return lines.map((line, index) => ({
        id: index,
        kind: 'context',
        text: line,
        oldNumber: index + 1,
        newNumber: index + 1,
    }));
}

/** A file's lines as rows outside every hunk, with the widest of them. */
export function textRows(lines: readonly DiffLine[]): { rows: DiffRow[]; widest: number } {
    return {
        rows: lines.map((line) => ({ kind: 'line', line, hunkIndex: -1 })),
        widest: widestOf(lines),
    };
}
