import type { ChangedFile, RepositorySnapshot, UnifiedDiff } from '@/modules/repository';
import { fixtureSummary } from './fixture-summary';

/** Enough files and lines that rendering them all would be slow: checks the virtualized lists. */
const FILE_COUNT = 5_000;
const DIFF_LINES = 50_000;

const FILES: ChangedFile[] = Array.from({ length: FILE_COUNT }, (_, i) => ({
    path: `generated/module-${String(i % 50).padStart(2, '0')}/file-${String(i).padStart(4, '0')}.ts`,
    origPath: null,
    area: i % 5 === 0 ? 'untracked' : 'unstaged',
    kind: i % 5 === 0 ? 'untracked' : 'modified',
    additions: (i % 40) + 1,
    deletions: i % 7,
    binary: false,
}));

/** A hunk's lines; unchanged lines between hunks are left to `wholeFileDiff`. */
const HUNK_SPAN = 98;
const HUNK_GAP = 10;

/**
 * Hunks as git cuts them, so the whole-file view finds the same ones: three unchanged lines at
 * each end, a line replaced every fifth line, and ten unchanged lines between hunks.
 */
function largeDiffText(): string {
    const lines: string[] = [];
    let oldStart = 1;
    let newStart = 1;
    while (lines.length < DIFF_LINES) {
        const body: string[] = [];
        for (let i = 0; i < HUNK_SPAN; i++) {
            const n = newStart + i;
            const text = `    const value${n} = compute(${n}, 'a fairly long line to scroll sideways ${'x'.repeat(n % 120)}');`;
            const changed = i >= 3 && i < HUNK_SPAN - 3 ? (i - 3) % 5 : -1;
            body.push(changed === 0 ? `-${text}` : changed === 1 ? `+${text}` : ` ${text}`);
        }
        const oldLines = body.filter((line) => !line.startsWith('+')).length;
        const newLines = body.filter((line) => !line.startsWith('-')).length;
        lines.push(
            `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@ export function block${newStart}() {`,
            ...body,
        );
        oldStart += oldLines + HUNK_GAP;
        newStart += newLines + HUNK_GAP;
    }
    return `${lines.join('\n')}\n`;
}

const BRANCH = {
    head: 'agent/bulk-refactor',
    commit: 'f00dbab',
    upstream: null,
    ahead: 0,
    behind: 0,
};

export function largeSnapshot(): RepositorySnapshot {
    // as if git listed more changes than the backend reads: shows the notice and the `+` counts
    return { files: FILES, summary: { ...fixtureSummary(BRANCH, FILES), truncated: true } };
}

let diffText: string | null = null;

/** Every file shows the same long diff, built once. */
export function largeDiff(): UnifiedDiff {
    diffText ??= largeDiffText();
    return { text: diffText, truncated: false };
}
