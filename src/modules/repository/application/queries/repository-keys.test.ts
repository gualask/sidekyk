import { describe, expect, it } from 'vitest';
import type { FileDiffRequest } from '../../model/repository.types';
import {
    commitKeys,
    folderOfKey,
    ignoredChangeTouches,
    repositoryKeys,
    worktreeChangeTouches,
} from './repository-keys';

const diff = (area: FileDiffRequest['area'], path: string, origPath: string | null = null) =>
    repositoryKeys.diff('p', { area, path, origPath, wholeFile: false });

describe('a change in the working tree', () => {
    it('reads again an open diff, file or colors only when a path is theirs', () => {
        const changed = ['src/cart.ts'];
        expect(worktreeChangeTouches(diff('unstaged', 'src/cart.ts'), changed)).toBe(true);
        expect(worktreeChangeTouches(diff('untracked', 'src/order.ts'), changed)).toBe(false);
        expect(worktreeChangeTouches(diff('unstaged', 'src/new.ts', 'src/cart.ts'), changed)).toBe(
            true,
        );
        expect(worktreeChangeTouches(repositoryKeys.file('p', 'src/cart.ts'), changed)).toBe(true);
        expect(worktreeChangeTouches(repositoryKeys.file('p', 'README.md'), changed)).toBe(false);
        expect(worktreeChangeTouches(repositoryKeys.preview('p', 'src/cart.ts'), changed)).toBe(
            true,
        );
        expect(worktreeChangeTouches(repositoryKeys.preview('p', 'README.md'), changed)).toBe(
            false,
        );
        expect(worktreeChangeTouches(repositoryKeys.stamp('p', 'src/cart.ts'), changed)).toBe(true);
        expect(worktreeChangeTouches(repositoryKeys.stamp('p', 'logo.png'), changed)).toBe(false);
        const colors = (path: string) =>
            repositoryKeys.colors('p', { path, version: { kind: 'worktree' } }, 0);
        expect(worktreeChangeTouches(colors('src/cart.ts'), changed)).toBe(true);
        expect(worktreeChangeTouches(colors('README.md'), changed)).toBe(false);
    });

    it("leaves a staged diff, the index and HEAD colors, the commits and the folder's kind alone", () => {
        const changed = ['src/cart.ts'];
        expect(worktreeChangeTouches(diff('staged', 'src/cart.ts'), changed)).toBe(false);
        const index = repositoryKeys.colors(
            'p',
            { path: 'src/cart.ts', version: { kind: 'index' } },
            0,
        );
        expect(worktreeChangeTouches(index, changed)).toBe(false);
        expect(worktreeChangeTouches(repositoryKeys.commits('p'), null)).toBe(false);
        // a change of kind is told as such
        expect(worktreeChangeTouches(repositoryKeys.kind('p'), null)).toBe(false);
    });

    it('reads again the snapshot and folders always, the rest when the paths are unknown', () => {
        expect(worktreeChangeTouches(repositoryKeys.snapshot('p'), [])).toBe(true);
        expect(worktreeChangeTouches(repositoryKeys.directory('p', 'src'), [])).toBe(true);
        expect(worktreeChangeTouches(repositoryKeys.file('p', 'README.md'), null)).toBe(true);
    });
});

describe('a change to ignored paths only', () => {
    it('reads again the folders holding them and an open file of theirs', () => {
        const changed = ['node_modules/pkg/index.js'];
        expect(ignoredChangeTouches(repositoryKeys.directory('p', 'node_modules'), changed)).toBe(
            true,
        );
        expect(ignoredChangeTouches(repositoryKeys.directory('p', 'src'), changed)).toBe(false);
        expect(ignoredChangeTouches(repositoryKeys.file('p', changed[0] ?? ''), changed)).toBe(
            true,
        );
        expect(ignoredChangeTouches(repositoryKeys.file('p', 'README.md'), changed)).toBe(false);
    });

    it('leaves alone what git status, Recent and the commits read', () => {
        expect(ignoredChangeTouches(repositoryKeys.snapshot('p'), null)).toBe(false);
        expect(ignoredChangeTouches(repositoryKeys.summary('p'), null)).toBe(false);
        expect(ignoredChangeTouches(repositoryKeys.recent('p'), null)).toBe(false);
        expect(ignoredChangeTouches(repositoryKeys.commits('p'), null)).toBe(false);
        expect(ignoredChangeTouches(repositoryKeys.directory('p', 'dist'), null)).toBe(true);
    });
});

describe('folderOfKey', () => {
    it("names the folder of a repository's key", () => {
        expect(folderOfKey(repositoryKeys.snapshot('p'))).toBe('p');
        expect(folderOfKey(diff('unstaged', 'a.ts'))).toBe('p');
        expect(
            folderOfKey(repositoryKeys.colors('p', { path: 'a.ts', version: { kind: 'head' } }, 1)),
        ).toBe('p');
    });

    it('names none for a key outside the repositories', () => {
        expect(folderOfKey(repositoryKeys.activity('p', 'abc', 0))).toBeNull();
        expect(folderOfKey(repositoryKeys.formatting('p'))).toBeNull();
        expect(folderOfKey(repositoryKeys.blob('p', 'abc'))).toBeNull();
        expect(folderOfKey(repositoryKeys.all)).toBeNull();
    });
});

describe('a query not asked for yet', () => {
    it('has a key of its own, kept apart from the other queries of its folder', () => {
        expect(repositoryKeys.unasked('p', 'diff')).not.toEqual(
            repositoryKeys.unasked('p', 'file'),
        );
        expect(commitKeys.unasked('p', 'files')).not.toEqual(commitKeys.unasked('p', 'diff'));
        expect(folderOfKey(repositoryKeys.unasked('p', 'file'))).toBe('p');
    });
});
