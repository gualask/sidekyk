import type { CSSProperties } from 'react';
import { notesPanel } from '@/modules/notes';
import { changesPanel, filesPanel } from '@/modules/repository';
import type { PanelDefinition } from '@/shared/panels/panel';

/**
 * Every panel, in the order of their shortcuts (`1`, `2`, …), which is also their order as tiles
 * at a project's panels (level 1), left to right.
 */
const PANELS: readonly PanelDefinition[] = [changesPanel, filesPanel, notesPanel];

/** The room between tiles, in pixels, where the splitter of a tile as wide as what it shows sits. */
export const TILE_GAP = 8;

/** A tile at a project's panels. */
export interface Tile {
    panel: PanelDefinition;
    /** Takes the width the other tiles leave; else as wide as what it shows. */
    fills: boolean;
    /** The least width it keeps, while the window has room for it. */
    minWidth: number;
}

/**
 * The tiles of a project's panels: Changes, which shows files, takes what the tree of Files
 * leaves; Files drags its width on the splitter before it, and gives way first when the window is
 * narrow.
 */
export const TILES: readonly Tile[] = [
    { panel: changesPanel, fills: true, minWidth: 560 },
    { panel: filesPanel, fills: false, minWidth: 160 },
];

/**
 * How wide a tile is: one that fills takes what the others leave; one as wide as what it shows
 * leaves the others their least width, as long as the window has room for its own.
 */
export function tileWidth(tile: Tile): CSSProperties {
    if (tile.fills) return { flexGrow: 1, flexBasis: 0 };
    const others = TILES.reduce(
        (room, other) => (other === tile ? room : room + other.minWidth + TILE_GAP),
        0,
    );
    return { flexBasis: 'auto', maxWidth: `max(${tile.minWidth}px, 100% - ${others}px)` };
}

/**
 * The panel selected at startup, among the tiles the app opens on. Their chunks start loading
 * with the app, not after the first render.
 */
export const INITIAL_PANEL = PANELS[0];
for (const { panel } of TILES) void panel.preload();

/** The tile next to a panel's, to the left (-1) or the right (1), if any. */
export function tileBeside(panel: PanelDefinition, step: -1 | 1): PanelDefinition | undefined {
    const index = TILES.findIndex((tile) => tile.panel === panel);
    return index < 0 ? undefined : TILES[index + step]?.panel;
}

/** The panels that say something about a project on its card at all projects. */
export const SUMMARIES = PANELS.flatMap((panel) =>
    panel.summary ? [{ id: panel.id, ...panel.summary }] : [],
);

/** The panels as the command palette offers them, with the keys that open them. */
export const PALETTE_PANELS = PANELS.map((panel) => ({
    id: panel.id,
    title: panel.title,
    shortcut: panelShortcut(panel),
}));

export function panelById(id: string): PanelDefinition | undefined {
    return PANELS.find((panel) => panel.id === id);
}

/** The panel a key opens full screen (`1`, `2`, …), if any. */
export function panelForKey(key: string): PanelDefinition | undefined {
    return /^[1-9]$/.test(key) ? PANELS[Number(key) - 1] : undefined;
}

/** The key that opens a panel, named in its tooltips. */
export function panelShortcut(panel: PanelDefinition): string {
    return String(PANELS.indexOf(panel) + 1);
}
