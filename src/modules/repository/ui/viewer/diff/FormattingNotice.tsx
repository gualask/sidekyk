import { IconAlertTriangle } from '@tabler/icons-react';
import { errorMessage } from '@/shared/errors/app-error';
import { type Translator, useTranslation } from '@/shared/i18n';
import type { FormattingCheck } from '../../../application/queries/formatting-check';
import type { FormattingTotals } from '../../../model/formatting';

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
    const { t } = i18n;
    const totals = check?.totals;
    const answer = totalsAnswer(totals, i18n);
    return (
        <div className="flex min-h-10 shrink-0 items-center gap-2 bg-ui-warning-soft py-1 pr-2 pl-3 text-xs text-ui-warning-soft-text">
            <IconAlertTriangle size={16} stroke={1.8} className="shrink-0 text-ui-warning" />
            <span className="min-w-0 flex-1 py-1">
                {lines === changed
                    ? t('view.formattingOnly')
                    : t('view.formattingSome', {
                          lines: count(lines, i18n),
                          changed: count(changed, i18n),
                      })}
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

/** The check over every change: none until asked, too many files to count, else its counts. */
function totalsAnswer(
    totals: FormattingTotals | null | undefined,
    i18n: Translator,
): string | null {
    if (totals === undefined) return null;
    if (totals === null) return i18n.t('view.formattingTooMany');
    return i18n.tp('view.formattingTotals', totals.changedFiles, {
        lines: count(totals.lines, i18n),
        changed: count(totals.changed, i18n),
        files: count(totals.files, i18n),
        changedFiles: count(totals.changedFiles, i18n),
    });
}

function count(n: number, i18n: Translator): string {
    return n.toLocaleString(i18n.formatTag);
}
