/**
 * Wire contracts with the Rust backend (`src-tauri/src/modules/settings/contracts.rs`).
 * Change both sides together.
 */

import type { DiffScrollbar } from '@/shared/git/diff-scrollbar';
import type { DiffView } from '@/shared/git/diff-view';
import type { NoteLines } from '@/shared/notes/note-lines';

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
    /** The view a diff opens in. */
    diffView: DiffView;
    /** How wide the scrollbar beside a diff, the map of its changes, is. */
    diffScrollbar: DiffScrollbar;
    /** What a copy from a diff puts on the clipboard (`shared/copy/copy-template.ts`). */
    copyTemplate: string;
    /** The sidebars' widths in pixels, as last dragged, by sidebar; one missing takes its default. */
    sidebarWidths: Record<string, number>;
    /** How a note's long lines show. */
    noteLines: NoteLines;
}

/** Where the global shortcut stands, as the backend registered it. */
export type GlobalShortcutStatus =
    | { kind: 'off' }
    /**
     * Registered. `conflict`: macOS uses the same keys for a shortcut of its own, which gets them
     * first.
     */
    | { kind: 'active'; keys: string; conflict: boolean }
    /**
     * The stored shortcut could not be registered at startup, as another app or the system holds
     * it: none works.
     */
    | { kind: 'refused'; keys: string }
    /** No global shortcut on this system: the plugin could not start. */
    | { kind: 'unavailable' }
    /** Linux: the desktop's own shortcut runs this command, which shows or hides Sidekyk. */
    | { kind: 'command'; command: string };
