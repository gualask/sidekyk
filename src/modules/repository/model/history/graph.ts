import type { Commit } from '../repository.types';

/**
 * The graph's commits laid out in lanes, as VS Code's graph draws them: each commit in a lane,
 * lines to its children above and its parents below. A lane never moves sideways, so a branch
 * keeps its column while it lasts; a first parent continues its child's lane, so HEAD's history
 * is one straight line. Children come before their parents (`--topo-order`).
 */

/**
 * A lane's color, by what it is: HEAD's, its upstream's, or another's, numbered from
 * `OTHER_COLORS` on in the order they start. The UI maps them to its palette.
 */
export const HEAD_COLOR = 0;
export const UPSTREAM_COLOR = 1;
export const OTHER_COLORS = 2;

/** A line within one row, between lanes: to the node from above, from it below, or straight by. */
export interface GraphLine {
    from: number;
    to: number;
    /** `top` joins the row's top edge to the node, `bottom` the node to its bottom edge. */
    half: 'top' | 'bottom' | 'full';
    color: number;
}

export interface GraphRow {
    /** The commit's lane. */
    lane: number;
    color: number;
    lines: GraphLine[];
    /** Lanes in use in this row, for its width. */
    width: number;
}

/** A lane: the commit it goes down to, in its color. */
interface Lane {
    sha: string;
    color: number;
}

/** The first free lane, or a new one after the last. */
function freeLane(lanes: readonly (Lane | null)[]): number {
    const free = lanes.indexOf(null);
    return free < 0 ? lanes.length : free;
}

export function graphRows(commits: readonly Commit[]): GraphRow[] {
    let lanes: (Lane | null)[] = [];
    let others = 0;
    const nextColor = () => OTHER_COLORS + others++;
    const rows: GraphRow[] = [];
    for (const commit of commits) {
        const before = lanes;
        let lane = before.findIndex((l) => l?.sha === commit.sha);
        let color: number;
        if (lane < 0) {
            // a tip: nothing above goes down to it
            lane = freeLane(before);
            const kinds = commit.refs.map((r) => r.kind);
            color = kinds.includes('head')
                ? HEAD_COLOR
                : kinds.includes('upstream')
                  ? UPSTREAM_COLOR
                  : nextColor();
        } else {
            color = before[lane]?.color ?? HEAD_COLOR;
        }
        const after = before.slice();
        const lines: GraphLine[] = [];
        before.forEach((l, j) => {
            if (!l) return;
            if (l.sha === commit.sha) {
                // every lane going down to this commit ends at its node
                lines.push({ from: j, to: lane, half: 'top', color: l.color });
                after[j] = null;
            } else {
                lines.push({ from: j, to: j, half: 'full', color: l.color });
            }
        });
        after[lane] = null;
        commit.parents.forEach((parent, n) => {
            // the first parent continues this lane, even when another lane goes down to it too:
            // both end at the parent. Another parent joins the lane going to it, or takes a free one.
            let target = n === 0 ? lane : after.findIndex((l) => l?.sha === parent);
            let parentColor = n === 0 ? color : (after[target]?.color ?? -1);
            if (target < 0) {
                target = freeLane(after);
                parentColor = nextColor();
            }
            after[target] = { sha: parent, color: parentColor };
            lines.push({ from: lane, to: target, half: 'bottom', color: parentColor });
        });
        while (after.length > 0 && after[after.length - 1] === null) after.pop();
        rows.push({
            lane,
            color,
            lines,
            width: Math.max(before.length, after.length, lane + 1),
        });
        lanes = after;
    }
    return rows;
}
