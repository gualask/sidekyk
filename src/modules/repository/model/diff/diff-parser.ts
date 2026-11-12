type DiffLineKind = 'context' | 'add' | 'del' | 'note';

export type LineEnd = 'crlf' | 'lf' | 'none';

export interface DiffLine {
    /** Position inside the hunk. Hunks never change once parsed, so it is a stable identity. */
    id: number;
    kind: DiffLineKind;
    text: string;
    oldNumber: number | null;
    newNumber: number | null;
    /**
     * A removed line, or the added line it pairs with, that differs from the other only in
     * whitespace or line ending (`markFormatting`): its line end, `none` on a file's last line
     * without one.
     */
    formatting?: LineEnd;
}

export interface DiffHunk {
    /** The `@@ … @@` line as git printed it. */
    header: string;
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    /** The enclosing function or section git names after the header, if any. */
    section: string;
    lines: DiffLine[];
}

export interface ParsedDiff {
    binary: boolean;
    hunks: DiffHunk[];
    /** The lines added and removed. */
    changedLines: number;
    /** Of those, the ones that differ only in formatting (`formatting`). */
    formattingLines: number;
}

/** `@@ -1,3 +1,4 @@ fn`, or `@@@ -1,3 -1,3 +1,4 @@@` for a combined (conflict) diff. */
const HUNK_HEADER = /^(@{2,}) (.+?) \1(?: (.*))?$/;

function parseRange(range: string): { start: number; lines: number } {
    const [start = '0', lines = '1'] = range.slice(1).split(',');
    return { start: Number(start), lines: Number(lines) };
}

function lineKind(prefix: string): DiffLineKind {
    if (prefix.includes('+')) return 'add';
    if (prefix.includes('-')) return 'del';
    return 'context';
}

/** Whitespace as `git diff -w` takes it: space, tab, line feed, vertical tab, form feed, CR. */
function isSpace(code: number): boolean {
    return code === 32 || (code >= 9 && code <= 13);
}

/** Whether two lines are the same once all their whitespace is left out, without copying them. */
export function sameButWhitespace(a: string, b: string): boolean {
    let i = 0;
    let j = 0;
    for (;;) {
        while (i < a.length && isSpace(a.charCodeAt(i))) i += 1;
        while (j < b.length && isSpace(b.charCodeAt(j))) j += 1;
        if (i === a.length || j === b.length) return i === a.length && j === b.length;
        if (a.charCodeAt(i) !== b.charCodeAt(j)) return false;
        i += 1;
        j += 1;
    }
}

/**
 * The lines of `kind` from `index` on, by index into `into`, with a side's `\ No newline at end
 * of file` note among them; returns the index past them.
 */
function takeRun(
    lines: readonly DiffLine[],
    index: number,
    kind: 'add' | 'del',
    into: number[],
): number {
    let at = index;
    for (; at < lines.length; at += 1) {
        const line = lines[at] as DiffLine;
        if (line.kind === kind) into.push(at);
        else if (line.kind !== 'note') break;
    }
    return at;
}

/** How the line at `index` ends: a note after it says it has no line end. */
function lineEnd(lines: readonly DiffLine[], index: number): LineEnd {
    if (lines[index + 1]?.kind === 'note') return 'none';
    return lines[index]?.text.endsWith('\r') ? 'crlf' : 'lf';
}

/**
 * Marks the lines that differ only in formatting, and returns how many: in each block of removed
 * then added lines of equal counts, the n-th removed with the n-th added. Blocks of unequal
 * counts are left alone, as lines moved or rewritten: pairing them would guess.
 */
function markFormatting(lines: readonly DiffLine[]): number {
    let marked = 0;
    let index = 0;
    const removed: number[] = [];
    const added: number[] = [];
    while (index < lines.length) {
        if (lines[index]?.kind !== 'del') {
            index += 1;
            continue;
        }
        removed.length = 0;
        added.length = 0;
        index = takeRun(lines, takeRun(lines, index, 'del', removed), 'add', added);
        if (removed.length === added.length) marked += markPairs(lines, removed, added);
    }
    return marked;
}

/** Marks each n-th removed line and n-th added line that differ only in whitespace; how many. */
function markPairs(lines: readonly DiffLine[], removed: number[], added: number[]): number {
    let marked = 0;
    for (let n = 0; n < removed.length; n++) {
        const was = removed[n] as number;
        const now = added[n] as number;
        const old = lines[was] as DiffLine;
        const line = lines[now] as DiffLine;
        if (!sameButWhitespace(old.text, line.text)) continue;
        old.formatting = lineEnd(lines, was);
        line.formatting = lineEnd(lines, now);
        marked += 2;
    }
    return marked;
}

/** A hunk from its header (`@@`, or one `@` more per parent past the first of a combined diff). */
function startHunk(line: string, header: RegExpExecArray): { hunk: DiffHunk; parents: number } {
    const [, ats = '@@', ranges = '', section = ''] = header;
    const parts = ranges.split(' ');
    const oldRange = parseRange(parts.find((p) => p.startsWith('-')) ?? '-0,0');
    const newRange = parseRange(parts.find((p) => p.startsWith('+')) ?? '+0,0');
    const hunk: DiffHunk = {
        header: line,
        oldStart: oldRange.start,
        oldLines: oldRange.lines,
        newStart: newRange.start,
        newLines: newRange.lines,
        section,
        lines: [],
    };
    return { hunk, parents: ats.length - 1 };
}

/** Whether a header line before the first hunk says the file is binary. */
function isBinaryNotice(line: string): boolean {
    return line.startsWith('Binary files ') || line === 'GIT binary patch';
}

/** A `\ No newline at end of file` note, at `id` in its hunk: on neither side. */
function noteLine(id: number, text: string): DiffLine {
    return { id, kind: 'note', text, oldNumber: null, newNumber: null };
}

/**
 * A line added, removed or kept, at `id` in its hunk, after its `parents` prefix columns; its
 * numbers on the sides it is on. A combined diff's lines have only their new side's.
 */
function contentLine(
    id: number,
    line: string,
    parents: number,
    oldNumber: number,
    newNumber: number,
): DiffLine {
    const kind = lineKind(line.slice(0, parents));
    const combined = parents > 1;
    return {
        id,
        kind,
        text: line.slice(parents),
        oldNumber: kind === 'add' || combined ? null : oldNumber,
        newNumber: kind === 'del' ? null : newNumber,
    };
}

/**
 * Parses the unified diff of one file. Headers before the first hunk are skipped, so prefix
 * settings such as `diff.noprefix` do not matter. A combined diff has one prefix column per
 * parent and no single old side, so its lines carry only new-side numbers.
 */
export function parseUnifiedDiff(text: string): ParsedDiff {
    const hunks: DiffHunk[] = [];
    let binary = false;
    let current: DiffHunk | null = null;
    let parents = 1;
    let oldNumber = 0;
    let newNumber = 0;
    let changedLines = 0;

    const lines = text.split('\n');
    if (lines.at(-1) === '') lines.pop();

    for (const line of lines) {
        const header = HUNK_HEADER.exec(line);
        if (header) {
            ({ hunk: current, parents } = startHunk(line, header));
            hunks.push(current);
            oldNumber = current.oldStart;
            newNumber = current.newStart;
            continue;
        }

        if (!current) {
            binary = binary || isBinaryNotice(line);
            continue;
        }

        if (line.startsWith('\\')) {
            current.lines.push(noteLine(current.lines.length, line));
            continue;
        }

        const entry = contentLine(current.lines.length, line, parents, oldNumber, newNumber);
        current.lines.push(entry);
        if (entry.kind !== 'add') oldNumber += 1;
        if (entry.kind !== 'del') newNumber += 1;
        if (entry.kind !== 'context') changedLines += 1;
    }

    // a combined diff's lines have a side per parent: no pair to compare
    let formattingLines = 0;
    if (parents === 1) for (const hunk of hunks) formattingLines += markFormatting(hunk.lines);
    return { binary, hunks, changedLines, formattingLines };
}
