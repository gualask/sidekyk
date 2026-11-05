import { IconAlertTriangle } from '@tabler/icons-react';
import { describeError } from '../errors/describe-error';
import type { Translator } from '../i18n';
import { CopyIcon } from './CopyIcon';
import { copyLabel, useCopyToClipboard } from './hooks/use-copy-to-clipboard';

/**
 * What shows where something stopped working (`ErrorBoundary`): what broke and what still works,
 * the error's message, a way out (`action`) and a copy of the details for a report. Given its
 * translator: at the window's root no provider may be left.
 */
export function CrashNotice({
    i18n,
    title,
    hint,
    error,
    action,
}: {
    i18n: Translator;
    title: string;
    hint: string;
    error: unknown;
    action: { label: string; run: () => void };
}) {
    const { copied, copy } = useCopyToClipboard();
    const message = error instanceof Error ? error.message : String(error);
    return (
        <div
            role="alert"
            className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center"
        >
            <IconAlertTriangle size={28} stroke={1.5} className="text-ui-danger" />
            <p className="text-sm font-semibold text-ui-text">{title}</p>
            <p className="max-w-sm text-xs text-ui-text-muted">{hint}</p>
            <p className="line-clamp-3 max-w-md font-mono text-[11.5px] break-words text-ui-text-muted">
                {message}
            </p>
            <div className="mt-2 flex gap-2">
                <button type="button" className="btn-primary-sm" onClick={action.run}>
                    {action.label}
                </button>
                <button
                    type="button"
                    className="btn-ghost-sm"
                    onClick={() => void copy('crash', describeError(error))}
                >
                    <CopyIcon copied={copied} />
                    {copyLabel(copied, i18n.t('crash.copy'), i18n)}
                </button>
            </div>
        </div>
    );
}
