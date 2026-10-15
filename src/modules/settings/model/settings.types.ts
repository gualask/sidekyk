/**
 * Wire contracts with the Rust backend (`src-tauri/src/modules/settings/contracts.rs`).
 * Change both sides together.
 */

/** The app's colors. Dark by default; it no longer follows the system's. */
export type Theme = 'dark' | 'light';

/**
 * The shortcut that shows and hides Sidekyk from any app. `keys` is its combination as the
 * backend registers it: modifiers first, then a `KeyboardEvent.code`, such as `Control+Alt+Space`
 * (see `model/shortcut-keys.ts`). Kept on Linux, which registers no shortcut of its own.
 */
export interface GlobalShortcut {
    enabled: boolean;
    keys: string;
}

export interface Settings {
    theme: Theme;
    globalShortcut: GlobalShortcut;
}

/** Why the system turned a shortcut down. */
export type ShortcutRefusal =
    /** Another app holds it, or the system keeps it for itself. */
    | 'taken'
    /** macOS allows no shortcut whose only modifiers are `⌥` and `⇧`. */
    | 'notAllowed';

/** Where the global shortcut stands, as the backend registered it. */
export type GlobalShortcutStatus =
    | { kind: 'off' }
    /**
     * Registered. `conflict`: macOS uses the same keys for a shortcut of its own, which gets them
     * first.
     */
    | { kind: 'active'; keys: string; conflict: boolean }
    /** The stored shortcut could not be registered at startup: none works. */
    | { kind: 'refused'; keys: string; reason: ShortcutRefusal }
    /** No global shortcut on this system: the plugin could not start. */
    | { kind: 'unavailable' }
    /** Linux: the desktop's own shortcut runs this command, which shows or hides Sidekyk. */
    | { kind: 'command'; command: string };
