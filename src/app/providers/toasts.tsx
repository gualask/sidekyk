import { lazy, type ReactNode, Suspense, useCallback, useState } from 'react';
import { type ToastRequest, ToastsProvider } from '@/shared/ui/toasts';
import { createToastQueue } from './toast-queue';

/** Base UI's toasts, loaded with the first toast: most sessions show none. */
const Toaster = lazy(() => import('./Toaster').then((module) => ({ default: module.Toaster })));

/** Lets the code below show toasts, and renders them once there is one. */
export function ToastsHost({ children }: { children: ReactNode }) {
    const [queue] = useState(createToastQueue);
    const [started, setStarted] = useState(false);
    const show = useCallback(
        (toast: ToastRequest) => {
            queue.push(toast);
            setStarted(true);
        },
        [queue],
    );

    return (
        <ToastsProvider value={show}>
            {children}
            {started ? (
                <Suspense fallback={null}>
                    <Toaster queue={queue} />
                </Suspense>
            ) : null}
        </ToastsProvider>
    );
}
