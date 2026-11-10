import type { UnifiedDiff } from '@/modules/repository';

/** Unchanged lines the fixtures' files have after their last change. */
const LINES_AFTER = 40;

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * A fixture's diff with every line of its file as context, as the backend answers a `wholeFile`
 * request: the unchanged lines between and after its hunks, which the fixtures do not have, are
 * made up and numbered.
 */
export function wholeFileDiff({ text, truncated }: UnifiedDiff): UnifiedDiff {
    const lines = text.split('\n');
    if (lines.at(-1) === '') lines.pop();
    const first = lines.findIndex((line) => HUNK_HEADER.test(line));
    if (first < 0) return { text, truncated };

    const body: string[] = [];
    let oldLine = 1;
    let newLine = 1;
    const unchangedUntil = (newEnd: number) => {
        for (; newLine < newEnd; oldLine++, newLine++) body.push(` // line ${newLine}`);
    };
    for (const line of lines.slice(first)) {
        const header = HUNK_HEADER.exec(line);
        if (header) {
            unchangedUntil(Number(header[3]) || 1);
            oldLine = Number(header[1]) || 1;
            continue;
        }
        body.push(line);
        if (!line.startsWith('+') && !line.startsWith('\\')) oldLine += 1;
        if (!line.startsWith('-') && !line.startsWith('\\')) newLine += 1;
    }
    unchangedUntil(newLine + LINES_AFTER);
    const oldCount = oldLine - 1;
    const newCount = newLine - 1;
    const head = `@@ -${oldCount ? 1 : 0},${oldCount} +${newCount ? 1 : 0},${newCount} @@`;
    return { text: `${[...lines.slice(0, first), head, ...body].join('\n')}\n`, truncated };
}
