/**
 * `+12 −3`; `binary` for a binary file; a dash when the lines were not counted (a very large new
 * file, or past the limits on how many new files are read).
 */
export function LineCounts({
    additions,
    deletions,
    binary = false,
}: {
    additions: number | null;
    deletions: number | null;
    binary?: boolean;
}) {
    if (binary) {
        return <span className="text-ui-text-muted">binary</span>;
    }
    if (additions === null && deletions === null) {
        return (
            <span className="text-ui-text-muted" title="Lines not counted">
                —
            </span>
        );
    }
    return (
        <span className="inline-flex gap-1.5 font-mono tabular-nums">
            <span className="text-ui-diff-add-mark">+{additions ?? 0}</span>
            <span className="text-ui-diff-del-mark">−{deletions ?? 0}</span>
        </span>
    );
}
