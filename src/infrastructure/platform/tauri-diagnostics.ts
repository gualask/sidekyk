import { invoke } from '@tauri-apps/api/core';

/** Writes a frontend error to the backend's log: `src-tauri/src/interfaces/tauri/diagnostics.rs`. */
export function reportFrontendError(message: string): void {
    // A report that cannot be delivered has nowhere better to go.
    invoke('log_frontend_error', { message }).catch(() => undefined);
}
