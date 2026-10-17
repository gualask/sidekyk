import type { ChangedFile, RepositorySummary } from '@/modules/repository';

type Branch = RepositorySummary['branch'];

/**
 * The summary the backend would build from these files (`summarize` in
 * `src-tauri/src/modules/repository/snapshot.rs`): one entry per path, tracked paths first in path
 * order as `git status` lists them, line counts only for tracked files.
 */
export function fixtureSummary(branch: Branch, files: readonly ChangedFile[]): RepositorySummary {
    const byPath = new Map<string, ChangedFile[]>();
    for (const file of files) byPath.set(file.path, [...(byPath.get(file.path) ?? []), file]);
    const entries = [...byPath.entries()].sort(([a, af], [b, bf]) => {
        const untracked = Number(af[0].area === 'untracked') - Number(bf[0].area === 'untracked');
        return untracked || (a < b ? -1 : a > b ? 1 : 0);
    });
    const tracked = files.filter((file) => file.area !== 'untracked');
    const sum = (count: (file: ChangedFile) => number | null) =>
        tracked.reduce((total, file) => total + (count(file) ?? 0), 0);

    return {
        branch,
        totals: {
            files: entries.length,
            additions: sum((file) => file.additions),
            deletions: sum((file) => file.deletions),
        },
        files: entries.slice(0, 3).map(([path, areas]) => {
            const staged = areas.find((file) => file.area === 'staged');
            const other = areas.find((file) => file.area !== 'staged');
            const kind =
                other?.kind === 'deleted' ? 'deleted' : (staged?.kind ?? other?.kind ?? 'modified');
            // as `git status`: a rename names the path it came from
            const origPath = areas.find((file) => file.origPath !== null)?.origPath ?? null;
            if (areas[0].area === 'untracked') {
                return { path, origPath, kind, additions: null, deletions: null, binary: false };
            }
            const add = (count: (file: ChangedFile) => number | null) =>
                areas.some((file) => count(file) !== null)
                    ? areas.reduce((total, file) => total + (count(file) ?? 0), 0)
                    : null;
            return {
                path,
                origPath,
                kind,
                additions: add((file) => file.additions),
                deletions: add((file) => file.deletions),
                binary: areas.some((file) => file.binary),
            };
        }),
        truncated: false,
    };
}
