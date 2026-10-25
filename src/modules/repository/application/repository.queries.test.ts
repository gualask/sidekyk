import { describe, expect, it } from 'vitest';
import type { FileDiffRequest } from '../model/repository.types';
import { repositoryKeys, worktreeChangeTouches } from './repository.queries';

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
