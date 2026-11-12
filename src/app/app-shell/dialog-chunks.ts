import { lazy } from 'react';
import { loadRemoveProjectDialog } from '@/modules/notes';
import { loadEditProjectDialog } from '@/modules/projects';
import { loadCommandPalette } from '@/modules/search';
import { loadSettingsDialog } from '@/modules/settings';
import { preloadable } from '@/shared/ui/preloadable';

export const SettingsDialog = preloadable(loadSettingsDialog, (module) => module.SettingsDialog);
export const CommandPalette = preloadable(loadCommandPalette, (module) => module.CommandPalette);
export const RemoveProjectDialog = preloadable(
    loadRemoveProjectDialog,
    (module) => module.RemoveProjectDialog,
);
export const EditProjectDialog = preloadable(
    loadEditProjectDialog,
    (module) => module.EditProjectDialog,
);
/** Asked on entering a project of several folders; loaded while nothing else happens. */
export const FolderPicker = preloadable(
    () => import('../FolderPicker'),
    (module) => module.FolderPicker,
);

/** Loaded when first asked for: the first paint does not show it. */
export const ShortcutsHelp = lazy(() =>
    import('../ShortcutsHelp').then((module) => ({ default: module.ShortcutsHelp })),
);

/** Fetches the code of the dialogs a key away: the settings, the palette, the folder picker. */
export function preloadDialogs() {
    void SettingsDialog.preload();
    void CommandPalette.preload();
    void FolderPicker.preload();
}
