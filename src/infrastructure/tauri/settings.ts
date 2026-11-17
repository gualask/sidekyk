import { invoke } from '@tauri-apps/api/core';

import type { SettingsPort } from '@/modules/settings';
import { onTauriEvent } from './events';

/**
 * Native settings adapter: commands in `src-tauri/src/interfaces/tauri/settings.rs`, the version
 * and the log in `diagnostics.rs`, the app's updates in `update.rs`.
 */
export const tauriSettings: SettingsPort = {
    getSettings: () => invoke('get_settings'),
    setSettings: (settings) => invoke('set_settings', { settings }),
    getGlobalShortcutStatus: () => invoke('get_global_shortcut_status'),
    setShortcutRecording: (recording) => invoke('set_shortcut_recording', { recording }),
    getVersion: () => invoke('get_version'),
    revealLog: () => invoke('reveal_log'),
    checkUpdate: () => invoke('check_update'),
    installUpdate: () => invoke('install_update'),
    onUpdateProgress: (listener) => onTauriEvent<number | null>('update-progress', listener),
};
