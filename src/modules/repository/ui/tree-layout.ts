import type { TreeRow } from '../model/file-tree';

/**
 * The tree's width by default and the least it takes: one width in a tile (the side column's)
 * and full screen.
 */
export const FILES_TREE_WIDTH = { initial: 280, min: 160 };

/** A row's height, which the virtualized tree lays its rows out with. */
export const TREE_ROW_HEIGHT = 22;

/** How far each level is indented, and where the first one starts, in pixels. */
export const TREE_INDENT = 14;
export const TREE_PADDING_LEFT = 6;
/** The chevron's room before a name, and the room after it, in pixels. */
export const TREE_TWISTY = 18;
export const TREE_PADDING_RIGHT = 10;

/** What the tree needs to show every row it has whole, from its font's width. */
export function fittingWidth(rows: readonly TreeRow[], element: HTMLElement): number {
    const style = getComputedStyle(element);
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return 0;
    context.font = `${style.fontSize} ${style.fontFamily}`;
    let widest = 0;
    for (const row of rows) {
        if (row.kind === 'more') continue;
        // a shared folder's `/` has a pixel of room on each side
        const slashes = row.name.split('/').length - 1;
        const text = context.measureText(row.name).width + slashes * 2;
        widest = Math.max(widest, TREE_PADDING_LEFT + row.depth * TREE_INDENT + text);
    }
    return Math.ceil(widest + TREE_TWISTY + TREE_PADDING_RIGHT);
}
