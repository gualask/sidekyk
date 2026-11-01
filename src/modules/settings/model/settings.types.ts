/**
 * Wire contracts with the Rust backend (`src-tauri/crates/core/src/modules/settings/contracts.rs`).
 * Change both sides together.
 */

import type { CodeLines } from '@/shared/git/code-lines';
import type { DiffScrollbar } from '@/shared/git/diff-scrollbar';
import type { DiffView } from '@/shared/git/diff-view';
import type { FileView } from '@/shared/git/file-view';
import type { Locale } from '@/shared/i18n';
import type { NoteLines } from '@/shared/notes/note-lines';

/** The app's colors. Dark by default; it no longer follows the system's. */
export type Theme = 'dark' | 'light';

/**
 * A global shortcut, from any app: the one that shows and hides Sidekyk, or the one that captures
 * an area of the screen. `keys` is its combination as the backend registers it: modifiers first,
 * then a `KeyboardEvent.code`, such as `Control+Alt+Space` (see `model/shortcut-keys.ts`). Kept
 * on Linux, which registers no shortcut of its own.
 */
export interface GlobalShortcut {
    enabled: boolean;
    keys: string;
}

export interface Settings {
    /** The UI's language; null until the system's is stored, at the first start. */
    language: Locale | null;
    theme: Theme;
    /** The shortcut that shows and hides Sidekyk. */
    globalShortcut: GlobalShortcut;
    /** The shortcut that captures an area of the screen. */
    captureShortcut: GlobalShortcut;
    /** The view a diff opens in. */
    diffView: DiffView;
    /** How a file that has a preview opens. */
    fileView: FileView;
    /** How wide the scrollbar beside a diff, the map of its changes, is. */
    diffScrollbar: DiffScrollbar;
    /** How the viewer shows a line longer than its width: scrolled sideways, or wrapped. */
    codeLines: CodeLines;
    /** What a copy from a diff puts on the clipboard (`shared/copy/copy-template.ts`). */
    copyTemplate: string;
    /** The sidebars' widths in pixels, as last dragged, by sidebar; one missing takes its default. */
    sidebarWidths: Record<string, number>;
    /** How a note's long lines show. */
    noteLines: NoteLines;
}

/** What a global shortcut does: shows and hides Sidekyk, or captures an area of the screen. */
export type ShortcutAction = 'toggle' | 'capture';

/** Where each global shortcut stands; `capture` is null where capture is not built yet. */
export interface GlobalShortcutStatuses {
    toggle: GlobalShortcutStatus;
    capture: GlobalShortcutStatus | null;
}

/** Where a global shortcut stands, as the backend registered it. */
export type GlobalShortcutStatus =
    | { kind: 'off' }
    /**
     * Registered. `conflict`: macOS uses the same keys for a shortcut of its own, which gets them
     * first.
     */
    | { kind: 'active'; keys: string; conflict: boolean }
    /**
     * The stored shortcut could not be registered at startup, as another app or the system holds
     * it: it does not work.
     */
    | { kind: 'refused'; keys: string }
    /** The stored shortcut has the other's keys, which that one took first: it does not work. */
    | { kind: 'inUse'; keys: string }
    /** No global shortcut on this system: the plugin could not start. */
    | { kind: 'unavailable' }
    /** Linux: the desktop's own shortcut runs this command, which does what the shortcut would. */
    | { kind: 'command'; command: string };
