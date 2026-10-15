export { type SettingsPort, SettingsProvider } from './application/settings.port';
export { useGlobalShortcutStatus } from './application/settings.queries';
export type { GlobalShortcutStatus, Settings } from './model/settings.types';
export { shortcutProblem } from './model/shortcut-problem';

/** The settings dialog, loaded once the window is idle after the first paint, or on first use. */
export const loadSettingsDialog = () => import('./ui/SettingsDialog');
