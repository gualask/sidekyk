import { HEAD_COLOR, OTHER_COLORS, UPSTREAM_COLOR } from '../../../model/history/graph';

/** The lanes of other branches, in turn, after HEAD's (the accent) and the upstream's. */
const OTHER_LANE_COLORS = [
    'var(--ui-series-2)',
    'var(--ui-series-3)',
    'var(--ui-series-4)',
    'var(--ui-series-6)',
] as const;

/** A lane's color in the palette, by what the lane is (`graph.ts`). */
export function laneColor(color: number): string {
    if (color === HEAD_COLOR) return 'var(--ui-accent)';
    if (color === UPSTREAM_COLOR) return 'var(--ui-series-5)';
    const other = (color - OTHER_COLORS) % OTHER_LANE_COLORS.length;
    return OTHER_LANE_COLORS[other] ?? OTHER_LANE_COLORS[0];
}
