export { type SettingsPort, SettingsProvider } from './application/settings.port';
export {
    useChangeSettings,
    useGlobalShortcutStatus,
    useSettingsWhenRead,
} from './application/settings.queries';
export type {
    GlobalShortcutStatuses,
    Settings,
    ShortcutAction,
} from './model/settings.types';
export { SHORTCUT_ACTIONS, shortcutProblem } from './model/shortcut-problem';

/** The settings dialog, loaded once the window is idle after the first paint, or on first use. */
export const loadSettingsDialog = () => import('./ui/SettingsDialog');
