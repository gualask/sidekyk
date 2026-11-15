import { useTranslation } from '@/shared/i18n';
import { countsText } from '../model/line-counts';

/**
 * A file's line counts (`countsText`), the lines added and removed in their colors; a dash when
 * the lines were not counted (a very large new file, or past the limits on how many new files are
 * read) says so in its tooltip.
 */
export function LineCounts({
    additions,
    deletions,
    binary = false,
    compact = false,
}: {
    additions: number | null;
    deletions: number | null;
    binary?: boolean;
    compact?: boolean;
}) {
    const i18n = useTranslation();
    const shown = countsText({ additions, deletions, binary }, i18n, compact);
    if (shown.kind !== 'lines') {
        return (
            <span
                className="text-ui-text-muted"
                title={shown.kind === 'notCounted' ? i18n.t('lines.notCounted') : undefined}
            >
                {shown.text}
            </span>
        );
    }
    return (
        <span className="inline-flex gap-1.5 font-mono tabular-nums">
            <span className="text-ui-diff-add-mark">{shown.added}</span>
            <span className="text-ui-diff-del-mark">{shown.removed}</span>
        </span>
    );
}

/** The lines of tracked files that changed against HEAD, kept short, exact in the tooltip. */
export function TrackedLines({ additions, deletions }: { additions: number; deletions: number }) {
    const { t } = useTranslation();
    return (
        <span title={t('lines.tracked', { additions, deletions })}>
            <LineCounts additions={additions} deletions={deletions} compact />
        </span>
    );
}
