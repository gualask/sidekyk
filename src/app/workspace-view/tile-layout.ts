import { FILES_TREE_SIDEBAR, FILES_TREE_WIDTH } from '@/modules/repository';
import type { PanelDefinition } from '@/shared/panels/panel';

/** The room between tiles, in pixels, where the splitter of the side column sits. */
export const TILE_GAP = 8;

/** What the main tile keeps of the width, the side column giving way first. */
export const MAIN_TILE_MIN_WIDTH = 560;

/**
 * The side column's width is the Files tree's (one setting with Files full screen): what the
 * column shows first, and what gives way first.
 */
export const SIDE_WIDTH = { sidebar: FILES_TREE_SIDEBAR, initial: FILES_TREE_WIDTH.initial };

/** The side column's least width: the widest least width of the tiles in it. */
export function sideMinWidth(panels: readonly PanelDefinition[]): number {
    return Math.max(0, ...panels.map((panel) => panel.tileMinWidth ?? 0));
}
