/**
 * Wire contracts with the Rust backend (`src-tauri/src/modules/settings/contracts.rs`).
 * Change both sides together.
 */

/** The app's colors. Dark by default; it no longer follows the system's. */
export type Theme = 'dark' | 'light';

export interface Settings {
    theme: Theme;
}
