import { listen } from '@tauri-apps/api/event';

/**
 * Attaches a Tauri event listener.
 *
 * - Returns a synchronous disposer.
 * - Handles late `listen()` resolution by disposing immediately when already disposed.
 * - Swallows registration failures to keep UI flows resilient in dev mode.
 */
export function onTauriEvent<T>(eventName: string, listener: (payload: T) => void): () => void {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listen<T>(eventName, (event) => listener(event.payload))
        .then((fn) => {
            if (disposed) {
                fn();
            } else {
                unlisten = fn;
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
