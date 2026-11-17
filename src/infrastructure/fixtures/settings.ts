import {
    DEFAULT_VIEW_SETTINGS,
    type GlobalShortcutStatuses,
    type Settings,
    type SettingsPort,
    SHORTCUT_ACTIONS,
    SHORTCUT_SETTING,
} from '@/modules/settings';
import { failure, type Scenario } from './scenario';

/** Shortcuts macOS keeps on by default: registered, but macOS gets them first. */
const MACOS_SHORTCUTS = ['Super+Space', 'Alt+Super+Space', 'Control+Super+Space'];

/** As the system answers, to see the warning: `⇧⌘Space` held by another app. */
const TAKEN_SHORTCUTS = ['Shift+Super+Space'];

const STORED_SHORTCUT = 'Control+Alt+Space';
const STORED_CAPTURE_SHORTCUT = 'Control+Alt+KeyC';
const STORED_NOTE_SHORTCUT = 'Control+Alt+KeyN';

/** The settings port: the settings kept, the global shortcuts as the system answers. */
export function fixtureSettings(scenario: Scenario): SettingsPort {
    // a browser tab follows the system's theme, or the one the devtools emulate: the setting is
    // only kept
    let settings: Settings = {
        language: null,
        theme: 'dark',
        globalShortcut: { enabled: true, keys: STORED_SHORTCUT },
        captureShortcut: { enabled: true, keys: STORED_CAPTURE_SHORTCUT },
        noteShortcut: { enabled: true, keys: STORED_NOTE_SHORTCUT },
        diffView: 'changes',
        sidebarWidths: {},
        ...DEFAULT_VIEW_SETTINGS,
    };
    // in `problems`, another app holds the stored shortcut since startup
    const taken = scenario === 'problems' ? [...TAKEN_SHORTCUTS, STORED_SHORTCUT] : TAKEN_SHORTCUTS;
    const shortcutStatus: GlobalShortcutStatuses = {
        toggle: taken.includes(STORED_SHORTCUT)
            ? { kind: 'refused', keys: STORED_SHORTCUT }
            : { kind: 'active', keys: STORED_SHORTCUT, conflict: false },
        capture: { kind: 'active', keys: STORED_CAPTURE_SHORTCUT, conflict: false },
        note: { kind: 'active', keys: STORED_NOTE_SHORTCUT, conflict: false },
    };
    const progressListeners = new Set<(percent: number | null) => void>();
    return {
        getSettings: async () => settings,
        // as the backend: a shortcut's settings unchanged change nothing, even refused
        setSettings: async (next) => {
            for (const action of SHORTCUT_ACTIONS) {
                const { enabled, keys } = next[SHORTCUT_SETTING[action]];
                const current = settings[SHORTCUT_SETTING[action]];
                if (enabled === current.enabled && keys === current.keys) continue;
                const inUse = SHORTCUT_ACTIONS.some((other) => {
                    const status = shortcutStatus[other];
                    return other !== action && status?.kind === 'active' && status.keys === keys;
                });
                if (enabled && inUse) throw failure('shortcut_in_use');
                if (enabled && taken.includes(keys)) throw failure('shortcut_taken');
                shortcutStatus[action] = enabled
                    ? { kind: 'active', keys, conflict: MACOS_SHORTCUTS.includes(keys) }
                    : { kind: 'off' };
            }
            settings = next;
            return settings;
        },
        getGlobalShortcutStatus: async () => ({ ...shortcutStatus }),
        setShortcutRecording: async () => undefined,
        getVersion: async () => '0.1.0',
        // a browser tab has no file manager to show it in
        revealLog: async () => undefined,
        // in `problems`, a newer version waits: its toast, its row in the settings
        checkUpdate: async () => (scenario === 'problems' ? '0.2.0' : null),
        // the download told as it goes, then nothing: a browser tab does not restart
        installUpdate: () =>
            new Promise((resolve) => {
                let percent = 0;
                const step = setInterval(() => {
                    percent += 10;
                    for (const listener of progressListeners) listener(percent);
                    if (percent < 100) return;
                    clearInterval(step);
                    resolve();
                }, 150);
            }),
        onUpdateProgress: (listener) => {
            progressListeners.add(listener);
            return () => progressListeners.delete(listener);
        },
    };
}
