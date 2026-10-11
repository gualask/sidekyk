import type { ChangedFile, FileDiff, RepositorySnapshot } from '@/modules/changes';
import { FIXTURE_REPOSITORY } from './review.fixture-data';

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

function largeDiffText(): string {
    const lines: string[] = [];
    for (let start = 1; start <= DIFF_LINES; start += 100) {
        lines.push(`@@ -${start},100 +${start},100 @@ export function block${start}() {`);
        for (let i = 0; i < 100; i++) {
            const n = start + i;
            const text = `    const value${n} = compute(${n}, 'a fairly long line to scroll sideways ${'x'.repeat(n % 120)}');`;
            lines.push(i % 10 === 0 ? `-${text}` : i % 10 === 1 ? `+${text}` : ` ${text}`);
        }
    }
    return `${lines.join('\n')}\n`;
}

export function largeSnapshot(): RepositorySnapshot {
    return {
        repository: FIXTURE_REPOSITORY,
        branch: {
            head: 'agent/bulk-refactor',
            commit: 'f00dbab',
            upstream: null,
            ahead: 0,
            behind: 0,
        },
        files: FILES,
        totals: {
            files: FILE_COUNT,
            additions: FILES.reduce((sum, f) => sum + (f.additions ?? 0), 0),
            deletions: FILES.reduce((sum, f) => sum + (f.deletions ?? 0), 0),
        },
    };
}

let diffText: string | null = null;

export function largeDiff(file: Pick<ChangedFile, 'area' | 'path'>): FileDiff {
    diffText ??= largeDiffText();
    return { path: file.path, area: file.area, text: diffText, truncated: false };
}
