import { useTranslation } from '@/shared/i18n';
import { compactCount } from '../model/summary';

/**
 * `+12 −3` (`+1.2k −340` when `compact`); `binary` for a binary file; a dash when the lines were not counted (a very large new
 * file, or past the limits on how many new files are read).
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
    const { t } = useTranslation();
    if (binary) {
        return <span className="text-ui-text-muted">{t('lines.binary')}</span>;
    }
    if (additions === null && deletions === null) {
        return (
            <span className="text-ui-text-muted" title={t('lines.notCounted')}>
                —
            </span>
        );
    }
    const shown = compact ? compactCount : String;
    return (
        <span className="inline-flex gap-1.5 font-mono tabular-nums">
            <span className="text-ui-diff-add-mark">+{shown(additions ?? 0)}</span>
            <span className="text-ui-diff-del-mark">−{shown(deletions ?? 0)}</span>
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
