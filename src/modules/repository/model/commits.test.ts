import { describe, expect, it } from 'vitest';
import { commitRequest, shortSha } from './commits';
import type { Commit } from './repository.types';

function commit(sha: string, parent: string | null = null): Commit {
    return { sha, parent, merge: false, author: 'Ada', time: 0, subject: `Commit ${sha}` };
}

describe('commits', () => {
    it('shows a hash as long as the summary does, and sends only what names a commit', () => {
        expect(shortSha('0123456789abcdef')).toBe('0123456');
        expect(commitRequest(commit('b2', 'a1'))).toEqual({ sha: 'b2', parent: 'a1' });
    });
});
