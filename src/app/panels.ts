import { notesPanel } from '@/modules/notes';
import { changesPanel, FILES_TREE_WIDTH, filesPanel } from '@/modules/repository';
import type { PanelDefinition } from '@/shared/panels/panel';

/**
 * Every panel, in the order of their shortcuts (`1`, `2`, …), which is also their order as tiles
 * at a project's panels (level 1), left to right.
 */
const PANELS: readonly PanelDefinition[] = [changesPanel, filesPanel, notesPanel];

/** The room between tiles, in pixels, where the splitter of the side column sits. */
export const TILE_GAP = 8;

/** Changes, on the left: it fills what the side column leaves, keeping this much. */
export const MAIN_TILE = { panel: changesPanel, minWidth: 560 };

/**
 * The side column, top to bottom: Files above Notes, each can be minimized to the top bar. The
 * column is as wide as Files' tree (one width with full screen), and wider while Notes is in it,
 * whose cards need the room; it gives way first when the window is narrow.
 */
export const SIDE_TILES: readonly PanelDefinition[] = [filesPanel, notesPanel];

/**
 * The side column's width is the Files tree's (one setting with Files full screen): what the
 * column shows first, and what gives way first.
 */
export const SIDE_WIDTH = { sidebar: 'files', initial: FILES_TREE_WIDTH.initial };

/** A tile's border, both sides (`PanelTile`): what a tile adds to what its panel shows. */
export const TILE_BORDERS = 2;

/** The side column's least width: the widest least width of the tiles in it. */
export function sideMinWidth(panels: readonly PanelDefinition[]): number {
    return Math.max(0, ...panels.map((panel) => panel.tileMinWidth ?? 0));
}

/** The panels shown as tiles, in their order: Changes, then the side column's not minimized. */
function shownTiles(minimized: readonly string[]): PanelDefinition[] {
    return [MAIN_TILE.panel, ...SIDE_TILES.filter((panel) => !minimized.includes(panel.id))];
}

/**
 * The panel selected at startup, among the tiles the app opens on. Their chunks start loading
 * with the app, not after the first render.
 */
export const INITIAL_PANEL = PANELS[0];
for (const panel of [MAIN_TILE.panel, ...SIDE_TILES]) void panel.preload();

/** The tile shown next to a panel's, before (-1) or after (1) it, if any. */
export function tileBeside(
    panel: PanelDefinition,
    step: -1 | 1,
    minimized: readonly string[],
): PanelDefinition | undefined {
    const tiles = shownTiles(minimized);
    const index = tiles.indexOf(panel);
    return index < 0 ? undefined : tiles[index + step];
}

/** The panels that say something about a project on its card at all projects. */
export const SUMMARIES = PANELS.flatMap((panel) =>
    panel.summary ? [{ id: panel.id, ...panel.summary }] : [],
);

/** The panels as the command palette offers them, with the keys that open them. */
export const PALETTE_PANELS = PANELS.map((panel) => ({
    id: panel.id,
    title: panel.title,
    icon: panel.icon,
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
