import type { ToastRequest } from '@/shared/ui/toasts';

/**
 * Between the code that shows a toast and the toaster, which loads on the first one: what comes
 * before the toaster is on screen waits, then goes to it in order.
 */
export interface ToastQueue {
    push(toast: ToastRequest): void;
    /** The toaster takes the toasts waiting, then each one as it comes. Returns a detacher. */
    drain(show: (toast: ToastRequest) => void): () => void;
}

export function createToastQueue(): ToastQueue {
    let waiting: ToastRequest[] = [];
    let target: ((toast: ToastRequest) => void) | null = null;
    return {
        push(toast) {
            if (target) target(toast);
            else waiting.push(toast);
        },
        drain(show) {
            target = show;
            const ready = waiting;
            waiting = [];
            for (const toast of ready) show(toast);
            return () => {
                if (target === show) target = null;
            };
        },
    };
}
