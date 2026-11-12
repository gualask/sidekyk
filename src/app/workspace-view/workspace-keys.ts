import { useEffect, useEffectEvent } from 'react';
import { neighbourProject, type ProjectList } from '@/modules/projects';
import type { PaletteMode } from '@/modules/search';
import type { PanelDefinition } from '@/shared/panels/panel';
import { shortcutKey } from '@/shared/platform/shortcut';
import { isField, isInOverlay, isKeyTaken } from '@/shared/ui/keys';
import { panelForKey } from '../panels';

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

/** What the workspace's keys do. */
interface WorkspaceKeys {
    list: ProjectList | undefined;
    /** Goes to the project before or after the one on screen (`[`, `]`). */
    switchProject: (projectId: string) => void;
    zoomIn: () => void;
    zoomOut: () => void;
    openPanel: (panel: PanelDefinition) => void;
    /** Selects the tile beside the selected one; false where there are no tiles. */
    moveTile: (step: -1 | 1) => boolean;
    toggleSettings: () => void;
    togglePalette: (mode: PaletteMode) => void;
    toggleHelp: () => void;
    newNote: () => void;
}

/**
 * The workspace's keyboard: `↵` zooms in and `Esc` out (after leaving a field: `Esc` is
 * progressive), `1`-`9` open a panel full screen, `←` and `→` move among a project's tiles, `[`
 * and `]` switch project, `⌘,` (`Ctrl+,`) opens the settings, `⌘K` (`Ctrl+K`) the command palette
 * to go somewhere and `⌘F` (`Ctrl+F`) to find in the files, also from inside the palette, `⌘N`
 * (`Ctrl+N`) a new note, also from a field, and `?` the shortcuts. Keys a field, a dialog or a
 * menu takes are left to it.
 */
export function useWorkspaceKeys(actions: WorkspaceKeys) {
    const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
        if (event.defaultPrevented) return;
        const shortcut = shortcutAction(event, actions);
        if (shortcut) {
            event.preventDefault();
            shortcut();
            return;
        }
        if (event.key === 'Escape' && isField(event.target)) {
            event.target.blur();
            return;
        }
        if (isKeyTaken(event.target) || !isPlain(event)) return;
        if (plainKey(event, actions)) event.preventDefault();
    });

    useEffect(() => {
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);
}

/** What a key with `⌘` (`Ctrl`) does here, if anything: the settings, a new note, the palette. */
function shortcutAction(event: KeyboardEvent, actions: WorkspaceKeys): (() => void) | null {
    const shortcut = shortcutKey(event);
    if (shortcut === ',') return actions.toggleSettings;
    if (shortcut === 'n' && !isInOverlay(event.target)) return actions.newNote;
    const paletteKey = shortcut === null ? undefined : PALETTE_KEYS[shortcut];
    return paletteKey ? () => actions.togglePalette(paletteKey) : null;
}

/** Does what a plain key asks of the workspace; false when it asks nothing here. */
function plainKey(event: KeyboardEvent, actions: WorkspaceKeys): boolean {
    const { key } = event;
    if (key === 'Escape') {
        actions.zoomOut();
        return true;
    }
    if (key === 'Enter') {
        if (event.target instanceof Element && event.target.closest(PRESSABLE)) return false;
        actions.zoomIn();
        return true;
    }
    if (key === 'ArrowLeft' || key === 'ArrowRight')
        return actions.moveTile(key === 'ArrowRight' ? 1 : -1);
    if (key === '?') {
        actions.toggleHelp();
        return true;
    }
    if (key === '[' || key === ']') {
        const next = actions.list ? neighbourProject(actions.list, key === ']' ? 1 : -1) : null;
        if (!next) return false;
        actions.switchProject(next);
        return true;
    }
    const panel = panelForKey(key);
    if (!panel) return false;
    actions.openPanel(panel);
    return true;
}
