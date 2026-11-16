import type { Settings, ShortcutAction } from './settings.types';

/** Every global shortcut, the window's first: the settings' rows and the top bar's problems. */
export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = ['toggle', 'capture', 'note'];

/** The setting each shortcut is stored in. */
export const SHORTCUT_SETTING = {
    toggle: 'globalShortcut',
    capture: 'captureShortcut',
    note: 'noteShortcut',
} as const satisfies Record<ShortcutAction, keyof Settings>;
