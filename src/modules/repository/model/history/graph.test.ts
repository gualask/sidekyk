import { describe, expect, it } from 'vitest';
import type { Commit, CommitRef } from '../repository.types';
import { graphRows, HEAD_COLOR, OTHER_COLORS, UPSTREAM_COLOR } from './graph';

function commit(sha: string, parents: string[], refs: CommitRef[] = []): Commit {
    return { sha, parents, author: 'Ada', time: 0, subject: sha, refs };
}

const head = (name = 'main'): CommitRef => ({ name, kind: 'head' });
const upstream = (name = 'origin/main'): CommitRef => ({ name, kind: 'upstream' });

describe('graphRows', () => {
    it('keeps a straight history in one lane, in HEAD’s color', () => {
        const rows = graphRows([commit('c', ['b'], [head()]), commit('b', ['a']), commit('a', [])]);
        expect(rows.map((r) => [r.lane, r.color, r.width])).toEqual([
            [0, HEAD_COLOR, 1],
            [0, HEAD_COLOR, 1],
            [0, HEAD_COLOR, 1],
        ]);
        expect(rows[0]?.lines).toEqual([{ from: 0, to: 0, half: 'bottom', color: HEAD_COLOR }]);
        expect(rows[1]?.lines).toEqual([
            { from: 0, to: 0, half: 'top', color: HEAD_COLOR },
            { from: 0, to: 0, half: 'bottom', color: HEAD_COLOR },
        ]);
        // a root commit: nothing below
        expect(rows[2]?.lines).toEqual([{ from: 0, to: 0, half: 'top', color: HEAD_COLOR }]);
    });

    it('gives the upstream its own lane until it meets HEAD at their common commit', () => {
        // HEAD: ours -> base; upstream: theirs -> base
        const rows = graphRows([
            commit('ours', ['base'], [head()]),
            commit('theirs', ['base'], [upstream()]),
            commit('base', ['root']),
            commit('root', []),
        ]);
        expect(rows.map((r) => [r.lane, r.color])).toEqual([
            [0, HEAD_COLOR],
            [1, UPSTREAM_COLOR],
            [0, HEAD_COLOR],
            [0, HEAD_COLOR],
        ]);
        // HEAD's lane goes by the upstream's commit
        expect(rows[1]?.lines).toContainEqual({ from: 0, to: 0, half: 'full', color: HEAD_COLOR });
        // both lanes end at the common commit, which goes on in HEAD's
        expect(rows[2]?.lines).toEqual([
            { from: 0, to: 0, half: 'top', color: HEAD_COLOR },
            { from: 1, to: 0, half: 'top', color: UPSTREAM_COLOR },
            { from: 0, to: 0, half: 'bottom', color: HEAD_COLOR },
        ]);
        expect(rows[3]?.width).toBe(1);
    });

    it('opens a lane for a merged branch and frees it where the branch started', () => {
        // merge of side into main: merge -> (main1, side1); side1 -> main1
        const rows = graphRows([
            commit('merge', ['main1', 'side1'], [head()]),
            commit('side1', ['main1']),
            commit('main1', []),
        ]);
        expect(rows.map((r) => r.lane)).toEqual([0, 1, 0]);
        // the first other branch's color
        const sideColor = OTHER_COLORS;
        expect(rows[1]?.color).toBe(sideColor);
        expect(rows[0]?.lines).toEqual([
            { from: 0, to: 0, half: 'bottom', color: HEAD_COLOR },
            { from: 0, to: 1, half: 'bottom', color: sideColor },
        ]);
        expect(rows[2]?.lines).toEqual([
            { from: 0, to: 0, half: 'top', color: HEAD_COLOR },
            { from: 1, to: 0, half: 'top', color: sideColor },
        ]);
        expect(rows[2]?.width).toBe(2);
    });

    it('goes on past the last commit read, for the next page', () => {
        const rows = graphRows([commit('c', ['b'], [head()])]);
        expect(rows[0]?.lines).toEqual([{ from: 0, to: 0, half: 'bottom', color: HEAD_COLOR }]);
        // the next page's first commit continues the lane
        const both = graphRows([commit('c', ['b'], [head()]), commit('b', [])]);
        expect(both[1]?.lane).toBe(0);
    });
});
