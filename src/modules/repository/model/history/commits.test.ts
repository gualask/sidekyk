import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/shared/i18n';
import type { Commit } from '../repository.types';
import { commitDate, commitRequest, isMerge, shortSha } from './commits';

function commit(sha: string, parents: string[] = []): Commit {
    return { sha, parents, author: 'Ada', time: 0, subject: `Commit ${sha}`, refs: [] };
}

describe('commits', () => {
    it('shows a hash as long as the summary does, and sends only what names a commit', () => {
        expect(shortSha('0123456789abcdef')).toBe('0123456');
        expect(commitRequest(commit('b2', ['a1']))).toEqual({ sha: 'b2', parent: 'a1' });
        // a merge is compared with its first parent; a root commit with nothing
        expect(commitRequest(commit('c3', ['b2', 'f6']))).toEqual({ sha: 'c3', parent: 'b2' });
        expect(commitRequest(commit('a1'))).toEqual({ sha: 'a1', parent: null });
    });

    it('tells a merge by its parents', () => {
        expect(isMerge(commit('c3', ['b2', 'f6']))).toBe(true);
        expect(isMerge(commit('b2', ['a1']))).toBe(false);
    });

    it('tells when a commit was made to the minute, the month in words', () => {
        const made = { ...commit('a1'), time: Date.UTC(2026, 10, 11, 10, 12, 9) / 1000 };
        const date = commitDate(made, createTranslator('en', 'en-US'));
        expect(date).toMatch(/Nov 11, 2026/);
        // no seconds
        expect(date).not.toMatch(/\d:\d\d:\d\d/);
    });
});
