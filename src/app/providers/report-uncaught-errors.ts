import { useEffect } from 'react';
import { describeError } from '@/shared/errors/describe-error';

/** An error loop must not flood the backend: past this many reports, the rest are dropped. */
const MAX_REPORTS = 50;

/** Sends uncaught errors and unhandled rejections to `report`, at most `MAX_REPORTS` times. */
export function useReportUncaughtErrors(report: (message: string) => void) {
    useEffect(() => {
        let reports = 0;
        const send = (reason: unknown) => {
            if (reports >= MAX_REPORTS) return;
            reports += 1;
            report(describeError(reason));
        };
        const onError = (event: ErrorEvent) => send(event.error ?? event.message);
        const onRejection = (event: PromiseRejectionEvent) => send(event.reason);

        window.addEventListener('error', onError);
        window.addEventListener('unhandledrejection', onRejection);
        return () => {
            window.removeEventListener('error', onError);
            window.removeEventListener('unhandledrejection', onRejection);
        };
    }, [report]);
}
