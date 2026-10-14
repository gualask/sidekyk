import { describe, expect, it } from 'vitest';
import type { RepositorySummary } from './repository.types';
import { changedCount } from './summary';

const summary = (files: number, truncated: boolean): RepositorySummary => ({
    branch: { head: 'main', commit: 'abc1234', upstream: null, ahead: 0, behind: 0 },
    totals: { files, additions: 0, deletions: 0 },
    files: [],
    truncated,
});

describe('changedCount', () => {
    it('says when there are more changes than were read', () => {
        expect(changedCount(summary(12, false))).toBe('12');
        expect(changedCount(summary(10_000, true))).toBe('10000+');
    });
});
