export { type SettingsPort, SettingsProvider } from './application/settings.port';
export {
    useChangeSettings,
    useGlobalShortcutStatus,
    useSettingsWhenRead,
} from './application/settings.queries';
export type {
    GlobalShortcutStatuses,
    Settings,
} from './model/settings.types';
export { SHORTCUT_ACTIONS, SHORTCUT_SETTING, shortcutProblem } from './model/shortcut-problem';

/** The settings dialog, loaded once the window is idle after the first paint, or on first use. */
export const loadSettingsDialog = () => import('./ui/SettingsDialog');
