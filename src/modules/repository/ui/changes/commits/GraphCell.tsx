import type { ReactNode } from 'react';
import type { GraphLine, GraphRow } from '../../../model/history/graph';
import { laneColor } from './lane-color';

/** A commit row's height: the list places its rows by it, and a lane's lines meet across rows. */
export const COMMIT_ROW_HEIGHT = 32;

/**
 * A lane's width. The graph grows with its lanes, as VS Code's, up to this share of a row: the
 * subject keeps the rest, and lanes past it are cut at its edge.
 */
const LANE_WIDTH = 14;
const GRAPH_MAX_SHARE = '33%';

const laneX = (lane: number) => LANE_WIDTH / 2 + lane * LANE_WIDTH;

/** A line of the row as a path: straight in its lane, or curving from one lane to another. */
function linePath({ from, to, half }: GraphLine): string {
    const middle = COMMIT_ROW_HEIGHT / 2;
    const [top, bottom] =
        half === 'top'
            ? [0, middle]
            : half === 'bottom'
              ? [middle, COMMIT_ROW_HEIGHT]
              : [0, COMMIT_ROW_HEIGHT];
    const [x1, x2] = [laneX(from), laneX(to)];
    if (x1 === x2) return `M${x1} ${top}V${bottom}`;
    const bend = (top + bottom) / 2;
    return `M${x1} ${top}C${x1} ${bend} ${x2} ${bend} ${x2} ${bottom}`;
}

/** The graph's column, as wide as its lanes up to its share of the row; past it, cut. */
export function GraphColumn({ lanes, children }: { lanes: number; children?: ReactNode }) {
    return (
        <span
            className="flex shrink-0 overflow-hidden"
            style={{ width: lanes * LANE_WIDTH, maxWidth: GRAPH_MAX_SHARE }}
        >
            {children}
        </span>
    );
}

/**
 * The commit's place in the graph, as VS Code's draws it: its lanes' lines through the row, a dot
 * in its own lane, a ring around a dot for a merge.
 */
export function GraphCell({ row, merge, lanes }: { row: GraphRow; merge: boolean; lanes: number }) {
    const color = laneColor(row.color);
    const x = laneX(row.lane);
    const y = COMMIT_ROW_HEIGHT / 2;
    return (
        <GraphColumn lanes={lanes}>
            <svg
                aria-hidden="true"
                width={lanes * LANE_WIDTH}
                height={COMMIT_ROW_HEIGHT}
                className="shrink-0"
            >
                {row.lines.map((line) => (
                    <path
                        key={`${line.from}-${line.to}-${line.half}`}
                        d={linePath(line)}
                        fill="none"
                        stroke={laneColor(line.color)}
                        strokeWidth={2}
                        strokeOpacity={0.7}
                    />
                ))}
                {merge ? (
                    <>
                        <circle
                            cx={x}
                            cy={y}
                            r={5}
                            fill="var(--ui-surface)"
                            stroke={color}
                            strokeWidth={2}
                        />
                        <circle cx={x} cy={y} r={2} fill={color} />
                    </>
                ) : (
                    <circle cx={x} cy={y} r={4.5} fill={color} />
                )}
            </svg>
        </GraphColumn>
    );
}
