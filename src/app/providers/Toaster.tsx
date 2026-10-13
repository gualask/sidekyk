import { Toast } from '@base-ui/react/toast';
import { IconX } from '@tabler/icons-react';
import { useEffect } from 'react';
import type { ToastRequest } from '@/shared/ui/toasts';
import type { ToastQueue } from './toast-queue';

/** How long information stays; the timer pauses while the pointer or the focus is on a toast. */
const INFO_TIMEOUT_MS = 4000;

/**
 * Toasts for passing events, bottom center, at most three on screen: information leaves by
 * itself, an error stays until closed. `F6` reaches them from the keyboard. Loaded with the first
 * toast, which it takes from the queue with the ones that came while it loaded.
 */
export function Toaster({ queue }: { queue: ToastQueue }) {
    return (
        <Toast.Provider limit={3}>
            <QueueFeed queue={queue} />
            <Toast.Portal>
                <Toast.Viewport className="fixed bottom-4 left-1/2 z-30 flex w-max max-w-[calc(100vw-32px)] -translate-x-1/2 flex-col-reverse items-center gap-2 outline-none">
                    <ToastList />
                </Toast.Viewport>
            </Toast.Portal>
        </Toast.Provider>
    );
}

function QueueFeed({ queue }: { queue: ToastQueue }) {
    // stable: the provider's store
    const { add } = Toast.useToastManager();
    useEffect(
        () =>
            queue.drain(({ title, description, kind = 'info' }: ToastRequest) => {
                const error = kind === 'error';
                add({
                    // the same message again refreshes the toast on screen instead of stacking
                    // a copy
                    id: `${kind}\0${title}\0${description ?? ''}`,
                    title,
                    description,
                    type: kind,
                    timeout: error ? 0 : INFO_TIMEOUT_MS,
                    priority: error ? 'high' : 'low',
                });
            }),
        [queue, add],
    );
    return null;
}

/** The newest first: the viewport stacks them upwards from the bottom edge. */
function ToastList() {
    const { toasts } = Toast.useToastManager();
    return toasts.map((toast) => {
        const error = toast.type === 'error';
        return (
            <Toast.Root
                key={toast.id}
                toast={toast}
                className={`flex max-w-[380px] items-center gap-2.5 rounded-[9px] border border-ui-border-hover bg-ui-surface py-2 pr-2 pl-3 text-[12.5px] font-semibold shadow-[0_10px_28px_var(--ui-shadow-soft)] outline-none [transform:translate(var(--toast-swipe-movement-x),var(--toast-swipe-movement-y))] transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] select-none focus-visible:ring-2 focus-visible:ring-ui-accent-muted data-ending-style:opacity-0 data-limited:hidden data-starting-style:[transform:translateY(8px)] data-starting-style:opacity-0 motion-reduce:transition-none ${
                    error ? 'border-l-[3px] border-l-ui-danger' : ''
                }`}
            >
                <div className="min-w-0 flex-1 pr-1">
                    <Toast.Title />
                    {toast.description ? (
                        <Toast.Description className="mt-0.5 font-medium text-ui-text-muted" />
                    ) : null}
                </div>
                {error ? (
                    <Toast.Close className="btn-icon h-[22px] w-[22px]" aria-label="Dismiss">
                        <IconX size={12} />
                    </Toast.Close>
                ) : null}
            </Toast.Root>
        );
    });
}
