import { invoke } from '@tauri-apps/api/core';

/** Shows the window, created hidden until the page paints: `src-tauri/src/interfaces/tauri/window.rs`. */
export function showWindow(): void {
    // the backend shows the window anyway after a few seconds
    invoke('show_window').catch(() => undefined);
}
