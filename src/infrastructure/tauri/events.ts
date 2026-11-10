import { listen } from '@tauri-apps/api/event';

/**
 * Attaches a listener whose registration resolves later (Tauri's `listen`, a webview's drags).
 *
 * - Returns a synchronous disposer.
 * - Handles late resolution by disposing immediately when already disposed.
 * - `onListening` runs once the listener is attached: what happened before it is not missed.
 * - Swallows registration failures to keep UI flows resilient in dev mode.
 */
export function attachListener(
    register: () => Promise<() => void>,
    onListening?: () => void,
): () => void {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void register()
        .then((fn) => {
            if (disposed) {
                fn();
            } else {
                unlisten = fn;
                onListening?.();
            }
        })
        .catch(() => {
            // Intentionally swallowed.
        });

    return () => {
        disposed = true;
        unlisten?.();
    };
}

/** Attaches a Tauri event listener (`attachListener`). */
export function onTauriEvent<T>(
    eventName: string,
    listener: (payload: T) => void,
    onListening?: () => void,
): () => void {
    return attachListener(
        () => listen<T>(eventName, (event) => listener(event.payload)),
        onListening,
    );
}
