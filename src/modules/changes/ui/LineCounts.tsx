/** `+12 −3`, or `binary` when git counts no lines. */
export function LineCounts({
    additions,
    deletions,
}: {
    additions: number | null;
    deletions: number | null;
}) {
    if (additions === null && deletions === null) {
        return <span className="text-ui-text-muted">binary</span>;
    }
    return (
        <span className="inline-flex gap-1.5 font-mono tabular-nums">
            <span className="text-ui-diff-add-mark">+{additions ?? 0}</span>
            <span className="text-ui-diff-del-mark">−{deletions ?? 0}</span>
        </span>
    );
}
