import { notesPanel } from '@/modules/notes';
import {
    changesPanel,
    FILES_TREE_WIDTH,
    type FolderKind,
    filesPanel,
    startPanel,
} from '@/modules/repository';
import type { PanelDefinition, PanelNeed } from '@/shared/panels/panel';

/**
 * Every panel, in the order of their shortcuts (`1`, `2`, …), which is also their order as tiles
 * at a project's panels (level 1), left to right.
 */
const PANELS: readonly PanelDefinition[] = [changesPanel, filesPanel, notesPanel];

/** The room between tiles, in pixels, where the splitter of the side column sits. */
export const TILE_GAP = 8;

/** What the main tile keeps of the width, the side column giving way first. */
export const MAIN_TILE_MIN_WIDTH = 560;

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

/**
 * A project's panels, from what it has: those whose needs it meets, in their order. With several,
 * level 1 lays them out as tiles: the first on the left (Changes for a repository, Files for a
 * folder without git), filling what the side column leaves; the others in that column, top to
 * bottom (Files above Notes), each can be minimized to the top bar; the column is as wide as
 * Files' tree, wider while Notes is in it, and gives way first. With one (Notes, without folder),
 * level 1 shows it as full screen does and there is no level 2.
 */
export interface ProjectTiles {
    panels: readonly PanelDefinition[];
    main: PanelDefinition;
    /** Empty when the project has one panel. */
    side: readonly PanelDefinition[];
    /** The panels saying something on the project's card at all projects. */
    summaries: readonly PanelSummary[];
    /** The panels that open full screen (level 2), by key or from the palette: none without tiles. */
    fullScreen: readonly PanelDefinition[];
}

/** A panel's summary, by the panel's id. */
type PanelSummary = NonNullable<PanelDefinition['summary']> & { id: string };

function summariesOf(panels: readonly PanelDefinition[]): PanelSummary[] {
    return panels.flatMap((panel) => (panel.summary ? [{ id: panel.id, ...panel.summary }] : []));
}

function tilesOf(panels: readonly PanelDefinition[]): ProjectTiles {
    const [main, ...side] = panels;
    return {
        panels,
        main,
        side,
        summaries: summariesOf(panels),
        fullScreen: side.length > 0 ? panels : [],
    };
}

function tilesMeeting(met: (need: PanelNeed) => boolean): ProjectTiles {
    return tilesOf(PANELS.filter((panel) => !panel.needs || met(panel.needs)));
}

/** One value per kind of project, so the panels of a project keep their identity across renders. */
const TILES = {
    repository: tilesMeeting(() => true),
    plain: tilesMeeting((need) => need === 'folder'),
    // a folder in a stopped WSL distro: its Start panel in place of the folder's, Notes beside
    stopped: tilesOf([startPanel, notesPanel]),
    none: tilesMeeting(() => false),
};

/**
 * A project's panels, from what its folder is (`useFolderKind`): `null` without folder, `stopped`
 * while the WSL distro that holds it is.
 */
export function projectTiles(kind: FolderKind | 'stopped' | null): ProjectTiles {
    return TILES[kind ?? 'none'];
}

/** The deepest level a project zooms to: 2 when its panels are tiles, else 1. */
export function deepestLevel(tiles: ProjectTiles): 1 | 2 {
    return tiles.side.length > 0 ? 2 : 1;
}

/** The panel selected at startup. Every chunk starts loading with the app, not after a render. */
export const INITIAL_PANEL = PANELS[0];
for (const panel of PANELS) void panel.preload();

/**
 * The tile shown next to a panel's, before (-1) or after (1) it, if any, among a project's tiles
 * not minimized.
 */
export function tileBeside(
    tiles: ProjectTiles,
    panel: PanelDefinition,
    step: -1 | 1,
    minimized: readonly string[],
): PanelDefinition | undefined {
    const shown = [tiles.main, ...tiles.side.filter((tile) => !minimized.includes(tile.id))];
    const index = shown.indexOf(panel);
    return index < 0 ? undefined : shown[index + step];
}

/** Every panel's summary: their chunks load while the app is idle, before all projects shows. */
export const SUMMARIES = summariesOf(PANELS);

/** The panels as the shortcuts list them, with the keys that open them full screen. */
export const PANEL_KEYS = PANELS.map((panel) => ({
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

/** The key that opens a panel, named in its tooltips; none for one that stands in (Start). */
export function panelShortcut(panel: PanelDefinition): string | null {
    const index = PANELS.indexOf(panel);
    return index < 0 ? null : String(index + 1);
}
