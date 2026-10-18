import type { ChangedFile, RepositorySummary } from '@/modules/repository';

type Branch = RepositorySummary['branch'];

/**
 * The summary the backend would build from these files (`summarize` in
 * `src-tauri/crates/core/src/modules/repository/snapshot.rs`): every path counted once, line
 * counts only for tracked files.
 */
export function fixtureSummary(branch: Branch, files: readonly ChangedFile[]): RepositorySummary {
    const tracked = files.filter((file) => file.area !== 'untracked');
    const sum = (count: (file: ChangedFile) => number | null) =>
        tracked.reduce((total, file) => total + (count(file) ?? 0), 0);

    return {
        branch,
        totals: {
            files: new Set(files.map((file) => file.path)).size,
            additions: sum((file) => file.additions),
            deletions: sum((file) => file.deletions),
        },
        truncated: false,
    };
}
