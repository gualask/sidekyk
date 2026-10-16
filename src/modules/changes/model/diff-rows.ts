import type { DiffHunk, DiffLine } from './diff-parser';
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

/** Matches the browser's default `tab-size`. */
const TAB_SIZE = 8;

function columns(text: string): number {
    let width = 0;
    for (const char of text)
        width = char === '\t' ? width + TAB_SIZE - (width % TAB_SIZE) : width + 1;
    return width;
}

/**
 * The widest line or hunk header, in monospace columns. Rows are positioned absolutely, so the
 * list sets its own width from this instead of growing with its content.
 */
export function widestLine(hunks: readonly DiffHunk[]): number {
    let widest = 0;
    for (const hunk of hunks) {
        widest = Math.max(widest, columns(hunk.header));
        for (const line of hunk.lines) {
            // most lines are short: skip the tab-aware count when it cannot win
            if (line.text.length * TAB_SIZE > widest) widest = Math.max(widest, columns(line.text));
        }
    }
    return widest;
}
