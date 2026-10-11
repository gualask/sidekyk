type DiffLineKind = 'context' | 'add' | 'del' | 'note';

export interface DiffLine {
    /** Position inside the hunk. Hunks never change once parsed, so it is a stable identity. */
    id: number;
    kind: DiffLineKind;
    text: string;
    oldNumber: number | null;
    newNumber: number | null;
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

    const lines = text.split('\n');
    if (lines.at(-1) === '') lines.pop();

    for (const line of lines) {
        const header = HUNK_HEADER.exec(line);
        if (header) {
            const [, ats = '@@', ranges = '', section = ''] = header;
            parents = ats.length - 1;
            const parts = ranges.split(' ');
            const oldRange = parseRange(parts.find((p) => p.startsWith('-')) ?? '-0,0');
            const newRange = parseRange(parts.find((p) => p.startsWith('+')) ?? '+0,0');
            current = {
                header: line,
                oldStart: oldRange.start,
                oldLines: oldRange.lines,
                newStart: newRange.start,
                newLines: newRange.lines,
                section,
                lines: [],
            };
            hunks.push(current);
            oldNumber = oldRange.start;
            newNumber = newRange.start;
            continue;
        }

        if (!current) {
            if (line.startsWith('Binary files ') || line === 'GIT binary patch') binary = true;
            continue;
        }

        if (line.startsWith('\\')) {
            current.lines.push({
                id: current.lines.length,
                kind: 'note',
                text: line,
                oldNumber: null,
                newNumber: null,
            });
            continue;
        }

        const kind = lineKind(line.slice(0, parents));
        const combined = parents > 1;
        current.lines.push({
            id: current.lines.length,
            kind,
            text: line.slice(parents),
            oldNumber: kind === 'add' || combined ? null : oldNumber,
            newNumber: kind === 'del' ? null : newNumber,
        });
        if (kind !== 'add') oldNumber += 1;
        if (kind !== 'del') newNumber += 1;
    }

    return { binary, hunks };
}
