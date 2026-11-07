import type { Translator } from '@/shared/i18n';
import type { RepositorySummary } from './repository.types';

/** What changed in one repository or several together: the counts a row shows. */
export type ChangedTotals = Pick<RepositorySummary, 'totals' | 'truncated'>;

/** What changed in several repositories, together: a project's of several folders. */
export function summedTotals(summaries: readonly ChangedTotals[]): ChangedTotals {
    return {
        totals: {
            files: summaries.reduce((sum, { totals }) => sum + totals.files, 0),
            additions: summaries.reduce((sum, { totals }) => sum + totals.additions, 0),
            deletions: summaries.reduce((sum, { totals }) => sum + totals.deletions, 0),
        },
        truncated: summaries.some((summary) => summary.truncated),
    };
}

/** How many files changed, kept short (`1.2k`), with a `+` when git listed more than were read. */
export function changedCount({ totals, truncated }: ChangedTotals): string {
    const files = compactCount(totals.files);
    return truncated ? `${files}+` : files;
}

/** A count kept short, rounded down: `340`, `1.2k`, `48k`, `1.2M`. */
export function compactCount(count: number): string {
    if (count < 1_000) return String(count);
    if (count < 10_000) return `${Math.floor(count / 100) / 10}k`;
    if (count < 1_000_000) return `${Math.floor(count / 1_000)}k`;
    return `${Math.floor(count / 100_000) / 10}M`;
}

/** What changed, in words: `8 changed`, or "clean". */
export function changedLabel(changed: ChangedTotals, { t, tp }: Translator): string {
    const { files } = changed.totals;
    if (files === 0) return t('changes.clean');
    return tp('changes.changedCount', files, { count: changedCount(changed) });
}
