export { type SettingsPort, SettingsProvider } from './application/settings.port';
export type { Settings } from './model/settings.types';

/** The settings dialog, loaded once the window is idle after the first paint, or on first use. */
export const loadSettingsDialog = () => import('./ui/SettingsDialog');
