import { IconAlertTriangle } from '@tabler/icons-react';
import { errorMessage } from '@/shared/errors/app-error';
import { useTranslation } from '@/shared/i18n';
import type { FormattingCheck } from '../application/repository.queries';

/**
 * Above a diff whose lines differ only in formatting, some or all of them: how many, and with
 * `check` (the working tree's) a button that counts them over every change, on request only.
 */
export function FormattingNotice({
    lines,
    changed,
    check,
}: {
    /** Lines added and removed that differ only in formatting. */
    lines: number;
    /** Lines added and removed. */
    changed: number;
    check: FormattingCheck | undefined;
}) {
    const i18n = useTranslation();
    const { t, tp, formatTag } = i18n;
    const count = (n: number) => n.toLocaleString(formatTag);
    const totals = check?.totals;
    let answer: string | null = null;
    if (totals === null) answer = t('view.formattingTooMany');
    else if (totals) {
        answer = tp('view.formattingTotals', totals.changedFiles, {
            lines: count(totals.lines),
            changed: count(totals.changed),
            files: count(totals.files),
            changedFiles: count(totals.changedFiles),
        });
    }
    return (
        <div className="flex min-h-10 shrink-0 items-center gap-2 bg-ui-warning-soft py-1 pr-2 pl-3 text-xs text-ui-warning-soft-text">
            <IconAlertTriangle size={16} stroke={1.8} className="shrink-0 text-ui-warning" />
            <span className="min-w-0 flex-1 py-1">
                {lines === changed
                    ? t('view.formattingOnly')
                    : t('view.formattingSome', { lines: count(lines), changed: count(changed) })}
                {answer ? <span className="block text-ui-text-secondary">{answer}</span> : null}
                {check?.error ? (
                    <span className="block text-ui-danger">{errorMessage(check.error, i18n)}</span>
                ) : null}
            </span>
            {check && totals === undefined ? (
                <button
                    type="button"
                    className="btn-ghost-sm shrink-0"
                    disabled={check.checking}
                    onClick={check.check}
                >
                    {t('view.formattingCheck')}
                </button>
            ) : null}
        </div>
    );
}
