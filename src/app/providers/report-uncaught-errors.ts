import { useEffect } from 'react';

/** An error loop must not flood the backend: past this many reports, the rest are dropped. */
const MAX_REPORTS = 50;

export function describeError(reason: unknown): string {
    if (reason instanceof Error) {
        // WebKit's `stack` lists the frames only, without the name and the message.
        const head = `${reason.name}: ${reason.message}`;
        return reason.stack ? `${head}\n${reason.stack}` : head;
    }
    return String(reason);
}

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
