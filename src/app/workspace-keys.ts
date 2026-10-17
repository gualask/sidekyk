import { useEffect, useEffectEvent } from 'react';
import { neighbourProject, type ProjectList, useActivateProject } from '@/modules/projects';
import type { PaletteMode } from '@/modules/search';
import type { PanelDefinition } from '@/shared/panels/panel';
import { shortcutKey } from '@/shared/platform/shortcut';
import { isField, isInOverlay, isKeyTaken } from '@/shared/ui/keys';
import { panelForKey } from './panels';

/** The palette's keys with `⌘` (`Ctrl`), by what they look for. */
const PALETTE_KEYS: Record<string, PaletteMode | undefined> = { k: 'names', f: 'contents' };

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
 * progressive), `1`-`9` open a panel full screen, `←` and `→` move among a project's tiles, `[`
 * and `]` switch project, `⌘,` (`Ctrl+,`) opens the settings, `⌘K` (`Ctrl+K`) the command palette
 * to go somewhere and `⌘F` (`Ctrl+F`) to find in the files, also from inside the palette, `⌘N`
 * (`Ctrl+N`) a new note, also from a field, and `?` the shortcuts. Keys a field, a dialog or a
 * menu takes are left to it.
 */
export function useWorkspaceKeys({
    list,
    zoomIn,
    zoomOut,
    openPanel,
    moveTile,
    toggleSettings,
    togglePalette,
    toggleHelp,
    newNote,
}: {
    list: ProjectList | undefined;
    zoomIn: () => void;
    zoomOut: () => void;
    openPanel: (panel: PanelDefinition) => void;
    /** Selects the tile beside the selected one; false where there are no tiles. */
    moveTile: (step: -1 | 1) => boolean;
    toggleSettings: () => void;
    togglePalette: (mode: PaletteMode) => void;
    toggleHelp: () => void;
    newNote: () => void;
}) {
    const activate = useActivateProject();

    const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
        if (event.defaultPrevented) return;
        const shortcut = shortcutKey(event);
        if (shortcut === ',') {
            event.preventDefault();
            toggleSettings();
            return;
        }
        if (shortcut === 'n' && !isInOverlay(event.target)) {
            event.preventDefault();
            newNote();
            return;
        }
        const paletteKey = shortcut === null ? undefined : PALETTE_KEYS[shortcut];
        if (paletteKey) {
            event.preventDefault();
            togglePalette(paletteKey);
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
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            if (!moveTile(event.key === 'ArrowRight' ? 1 : -1)) return;
        } else if (event.key === '?') {
            toggleHelp();
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
