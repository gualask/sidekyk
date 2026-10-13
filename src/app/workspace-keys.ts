import { useEffect, useEffectEvent } from 'react';
import { neighbourProject, type ProjectList, useActivateProject } from '@/modules/projects';
import type { PanelDefinition } from '@/shared/panels/panel';
import { hasShortcutModifier } from '@/shared/platform/shortcut';
import { isField, isKeyTaken } from '@/shared/ui/keys';
import { panelForKey } from './panels';

/** A control that `↵` already presses: the key is its, not a zoom. */
const PRESSABLE = 'button, a[href], [role="button"], [role="radio"], [role="menuitem"]';

/**
 * Whether a printable key came without a shortcut modifier. `AltGr` counts as `Ctrl+Alt` on Linux
 * and Windows, and `⌥` types characters on macOS: `[` is `⌥è` on an Italian Mac, `AltGr+è` on
 * an Italian PC.
 */
function isPlain(event: KeyboardEvent): boolean {
    return !event.metaKey && (!event.ctrlKey || event.altKey);
}

/**
 * The workspace's keyboard: `↵` zooms in and `Esc` out (after leaving a field: `Esc` is
 * progressive), `1`-`9` open a panel full screen, `[` and `]` switch project, `⌘,` (`Ctrl+,`)
 * opens the settings. Keys a field, a dialog or a menu takes are left to it.
 */
export function useWorkspaceKeys({
    list,
    zoomIn,
    zoomOut,
    openPanel,
    toggleSettings,
}: {
    list: ProjectList | undefined;
    zoomIn: () => void;
    zoomOut: () => void;
    openPanel: (panel: PanelDefinition) => void;
    toggleSettings: () => void;
}) {
    const activate = useActivateProject();

    const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
        if (event.defaultPrevented) return;
        if (hasShortcutModifier(event) && !event.altKey && event.key === ',') {
            event.preventDefault();
            toggleSettings();
            return;
        }
        if (event.key === 'Escape' && isField(event.target)) {
            event.target.blur();
            return;
        }
        if (isKeyTaken(event.target) || !isPlain(event)) return;

        if (event.key === 'Escape') {
            zoomOut();
        } else if (event.key === 'Enter') {
            if (event.target instanceof Element && event.target.closest(PRESSABLE)) return;
            zoomIn();
        } else if (event.key === '[' || event.key === ']') {
            const next = list ? neighbourProject(list, event.key === ']' ? 1 : -1) : null;
            if (!next) return;
            activate(next);
        } else {
            const panel = panelForKey(event.key);
            if (!panel) return;
            openPanel(panel);
        }
        event.preventDefault();
    });

    useEffect(() => {
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);
}
