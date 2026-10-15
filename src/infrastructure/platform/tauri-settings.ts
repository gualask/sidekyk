import { invoke } from '@tauri-apps/api/core';

import type { SettingsPort } from '@/modules/settings';

/** Native settings adapter: commands in `src-tauri/src/interfaces/tauri/settings.rs`. */
export const tauriSettings: SettingsPort = {
    getSettings: () => invoke('get_settings'),
    setSettings: (settings) => invoke('set_settings', { settings }),
    getGlobalShortcutStatus: () => invoke('get_global_shortcut_status'),
    setShortcutRecording: (recording) => invoke('set_shortcut_recording', { recording }),
};
