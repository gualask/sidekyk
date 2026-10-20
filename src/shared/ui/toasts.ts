import { createContext, createElement, type ReactNode, useContext } from 'react';
import { errorMessage } from '../errors/app-error';
import type { Translator } from '../i18n';

/** A passing event, told at the bottom of the window. */
export interface ToastRequest {
    title: string;
    description?: string;
    /** An error stays until closed; anything else leaves by itself. */
    kind?: 'info' | 'error';
    /** What the toast offers to do, such as undoing what it tells: a button that closes it. */
    action?: { label: string; run: () => void };
}

/** A failure, told by what failed and why. */
export function errorToast(title: string, error: unknown, i18n: Translator): ToastRequest {
    return { kind: 'error', title, description: errorMessage(error, i18n) };
}

type ShowToast = (toast: ToastRequest) => void;

const ToastsContext = createContext<ShowToast | null>(null);

export function ToastsProvider({ value, children }: { value: ShowToast; children: ReactNode }) {
    return createElement(ToastsContext.Provider, { value }, children);
}

/** Shows a toast; the app renders them (`src/app/providers/toasts.tsx`). */
export function useShowToast(): ShowToast {
    const show = useContext(ToastsContext);
    if (!show) {
        throw new Error('useShowToast must be used within ToastsProvider');
    }
    return show;
}
