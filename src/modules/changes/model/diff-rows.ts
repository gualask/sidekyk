import type { DiffHunk, DiffLine } from './diff-parser';

/** The diff as one flat list, so only the rows on screen are rendered. */
export type DiffRow =
    | { kind: 'hunk'; hunk: DiffHunk; hunkIndex: number }
    | { kind: 'line'; line: DiffLine; hunkIndex: number };

export function diffRows(hunks: readonly DiffHunk[]): DiffRow[] {
    const rows: DiffRow[] = [];
    hunks.forEach((hunk, hunkIndex) => {
        rows.push({ kind: 'hunk', hunk, hunkIndex });
        for (const line of hunk.lines) rows.push({ kind: 'line', line, hunkIndex });
    });
    return rows;
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
