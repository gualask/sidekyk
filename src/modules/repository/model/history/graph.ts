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
        const { lane, color } = laneOf(before, commit, nextColor);
        const { after, lines } = linesThrough(before, commit.sha, lane);
        lines.push(...placeParents(after, commit.parents, lane, color, nextColor));
        while (after.length > 0 && after[after.length - 1] === null) after.pop();
        rows.push({ lane, color, lines, width: Math.max(before.length, after.length, lane + 1) });
        lanes = after;
    }
    return rows;
}

/**
 * The commit's lane and color: the lane going down to it, or for a tip (nothing above goes down to
 * it) a free one, HEAD's or the upstream's color when it is theirs, else the next.
 */
function laneOf(
    before: readonly (Lane | null)[],
    commit: Commit,
    nextColor: () => number,
): { lane: number; color: number } {
    const lane = before.findIndex((l) => l?.sha === commit.sha);
    if (lane >= 0) return { lane, color: before[lane]?.color ?? HEAD_COLOR };
    const kinds = commit.refs.map((r) => r.kind);
    const color = kinds.includes('head')
        ? HEAD_COLOR
        : kinds.includes('upstream')
          ? UPSTREAM_COLOR
          : nextColor();
    return { lane: freeLane(before), color };
}

/**
 * The lines of the lanes above through the commit's row, and the lanes below it before its
 * parents take theirs: every lane going down to the commit ends at its node, the others go
 * straight by.
 */
function linesThrough(
    before: readonly (Lane | null)[],
    sha: string,
    lane: number,
): { after: (Lane | null)[]; lines: GraphLine[] } {
    const after = before.slice();
    const lines: GraphLine[] = [];
    before.forEach((l, j) => {
        if (!l) return;
        if (l.sha === sha) {
            lines.push({ from: j, to: lane, half: 'top', color: l.color });
            after[j] = null;
        } else {
            lines.push({ from: j, to: j, half: 'full', color: l.color });
        }
    });
    after[lane] = null;
    return { after, lines };
}

/**
 * Places the commit's parents in the lanes below it (`after`), and returns the lines from its node
 * to them. The first parent continues the commit's lane, even when another lane goes down to it
 * too: both end at the parent. Another parent joins the lane going to it, or takes a free one.
 */
function placeParents(
    after: (Lane | null)[],
    parents: readonly string[],
    lane: number,
    color: number,
    nextColor: () => number,
): GraphLine[] {
    return parents.map((parent, n) => {
        let target = n === 0 ? lane : after.findIndex((l) => l?.sha === parent);
        let parentColor = n === 0 ? color : (after[target]?.color ?? -1);
        if (target < 0) {
            target = freeLane(after);
            parentColor = nextColor();
        }
        after[target] = { sha: parent, color: parentColor };
        return { from: lane, to: target, half: 'bottom', color: parentColor };
    });
}
