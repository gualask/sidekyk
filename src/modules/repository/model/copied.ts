import { fillCopyTemplate } from '@/shared/copy/copy-template';
import type { DiffHunk, DiffLine } from './diff-parser';

/** The file a copy comes from, as `{row}` names it. */
export interface CopySource {
    path: string;
    /** The path before a rename: where removed lines were. */
    origPath: string | null;
    /** The commit shown (its short hash), whose version the line numbers are of; null for the working tree. */
    commit: string | null;
}

/** What a copy from a diff is made of, before the user's template puts it on the clipboard. */
export interface Copied {
    /**
     * Where the text is: `src/cart.ts:14`, `src/cart.ts:12-15`; `(removed)` for lines that are
     * only removed, and the commit when the diff is a commit's (`(a1b2c3d)`).
     */
    row: string;
    text: string;
    /** The lines alone, as a confirmation names them: `14`, `12-15`; empty with none. */
    lines: string;
}

const PREFIX: Record<DiffLine['kind'], string> = { context: ' ', add: '+', del: '-', note: '' };

function lineRange(start: number, count: number): string {
    return count <= 1 ? `${start}` : `${start}-${start + count - 1}`;
}

/** Lines `first` to `last` of a side, numbered as git numbers them. */
function span(numbers: readonly number[]): string {
    const first = numbers[0] ?? 0;
    return lineRange(first, (numbers.at(-1) ?? first) - first + 1);
}

/** `{row}` for lines of the new side, or for lines that were only removed. */
function located(source: CopySource, lines: string, removed: boolean): Copied['row'] {
    const path = removed ? (source.origPath ?? source.path) : source.path;
    const where = lines ? `${path}:${lines}` : path;
    if (removed) return `${where} (removed${source.commit ? ` in ${source.commit}` : ''})`;
    return source.commit ? `${where} (${source.commit})` : where;
}

/**
 * Where lines sit, on the new side; lines that are only removed have no new side, so they point
 * at the old one instead.
 */
function placed(source: CopySource, lines: readonly DiffLine[]): Pick<Copied, 'row' | 'lines'> {
    const now = lines.flatMap((line) => (line.newNumber === null ? [] : [line.newNumber]));
    if (now.length > 0) return { row: located(source, span(now), false), lines: span(now) };
    const old = lines.flatMap((line) => (line.oldNumber === null ? [] : [line.oldNumber]));
    if (old.length > 0) return { row: located(source, span(old), true), lines: span(old) };
    return { row: located(source, '', false), lines: '' };
}

/** A hunk: where it sits, and its lines with their `+` and `-`. */
export function hunkCopied(source: CopySource, hunk: DiffHunk): Copied {
    const removed = hunk.newLines === 0;
    const lines = removed
        ? lineRange(hunk.oldStart, hunk.oldLines)
        : lineRange(hunk.newStart, hunk.newLines);
    const text = hunk.lines.map((line) => `${PREFIX[line.kind]}${line.text}`).join('\n');
    return { row: located(source, lines, removed), text, lines };
}

/** One line: where it is, and its text as in the file. */
export function lineCopied(source: CopySource, line: DiffLine): Copied {
    return { ...placed(source, [line]), text: line.text };
}

/** Text selected with the mouse, exactly, and the lines it spans. */
export function selectionCopied(
    source: CopySource,
    lines: readonly DiffLine[],
    text: string,
): Copied {
    return { ...placed(source, lines), text };
}

/** What a copy took, as its confirmation names it: "line 14", "lines 13–17". */
export function copiedLabel({ lines }: Copied): string {
    return lines.includes('-') ? `lines ${lines.replace('-', '–')}` : `line ${lines}`;
}

/** Through the user's template. */
export function copiedText(template: string, copied: Copied): string {
    return fillCopyTemplate(template, copied);
}

/** Every hunk of a file through the template, one after the other. */
export function fileText(template: string, source: CopySource, hunks: readonly DiffHunk[]): string {
    return hunks.map((hunk) => copiedText(template, hunkCopied(source, hunk))).join('\n\n');
}
