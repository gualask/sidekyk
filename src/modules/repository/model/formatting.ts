import type { ChangedFile, ChangesIgnoringWhitespace } from './repository.types';

/** How much of the staged and unstaged changes is formatting only, over every file. */
export interface FormattingTotals {
    /** Lines added and removed that differ only in formatting. */
    lines: number;
    /** Lines added and removed, untracked files left out: nothing in a new file is formatting. */
    changed: number;
    /** Files with formatting-only lines. */
    files: number;
    /** Files with lines added or removed, staged or unstaged. */
    changedFiles: number;
}

/**
 * The formatting-only lines of the snapshot's `files`: in each staged or unstaged file, the lines
 * its counts have more than the same diff with whitespace ignored. A file missing from that diff
 * changed only in formatting. Null when the diff was cut, as a missing file then tells nothing.
 */
export function formattingTotals(
    files: readonly ChangedFile[],
    ignoring: ChangesIgnoringWhitespace,
): FormattingTotals | null {
    if (ignoring.truncated) return null;
    const left = new Map(
        ignoring.files.map((f) => [`${f.area}\0${f.path}`, f.additions + f.deletions]),
    );
    let lines = 0;
    let changed = 0;
    const changedPaths = new Set<string>();
    const formattedPaths = new Set<string>();
    for (const { path, area, additions, deletions } of files) {
        if (area === 'untracked' || additions === null || deletions === null) continue;
        const count = additions + deletions;
        if (count === 0) continue;
        const formatting = Math.max(0, count - (left.get(`${area}\0${path}`) ?? 0));
        changed += count;
        lines += formatting;
        changedPaths.add(path);
        if (formatting > 0) formattedPaths.add(path);
    }
    return { lines, changed, files: formattedPaths.size, changedFiles: changedPaths.size };
}
