import { describe, expect, it } from 'vitest';
import { changeSides, commitSides, fileSides, imageSides } from './sides';

describe('sides', () => {
    it('compare the versions each area compares', () => {
        const worktree = { kind: 'worktree' } as const;
        expect(changeSides({ path: 'a.ts', origPath: null, area: 'unstaged' })).toEqual({
            old: { path: 'a.ts', version: { kind: 'index' } },
            new: { path: 'a.ts', version: worktree },
        });
        expect(changeSides({ path: 'b.ts', origPath: 'a.ts', area: 'staged' })).toEqual({
            old: { path: 'a.ts', version: { kind: 'head' } },
            new: { path: 'b.ts', version: { kind: 'index' } },
        });
        expect(changeSides({ path: 'n.ts', origPath: null, area: 'untracked' })).toEqual({
            old: null,
            new: { path: 'n.ts', version: worktree },
        });
        expect(fileSides('r.md')).toEqual({ old: null, new: { path: 'r.md', version: worktree } });
    });

    it('compare a commit with its parent, a root commit with nothing', () => {
        const file = { path: 'b.ts', origPath: 'a.ts' };
        expect(commitSides({ sha: 'c2', parent: 'c1' }, file)).toEqual({
            old: { path: 'a.ts', version: { kind: 'commit', sha: 'c1' } },
            new: { path: 'b.ts', version: { kind: 'commit', sha: 'c2' } },
        });
        expect(commitSides({ sha: 'c1', parent: null }, file).old).toBeNull();
    });
});

describe('imageSides', () => {
    const png = { path: 'logo.png', origPath: null };
    const blobs = { kind: 'modified' as const, oldBlob: 'aaa', newBlob: 'bbb' };

    it('take a git version by its object, the working tree as it is', () => {
        expect(imageSides(changeSides({ ...png, area: 'staged' }), blobs)).toEqual({
            old: { path: 'logo.png', version: { kind: 'head' }, blob: 'aaa' },
            new: { path: 'logo.png', version: { kind: 'index' }, blob: 'bbb' },
        });
        const unstaged = imageSides(changeSides({ ...png, area: 'unstaged' }), {
            ...blobs,
            newBlob: null,
        });
        expect(unstaged.new).toEqual({
            path: 'logo.png',
            version: { kind: 'worktree' },
            blob: null,
        });
    });

    it('leave out a side with no file: added, deleted, a root commit', () => {
        const added = { kind: 'added' as const, oldBlob: null, newBlob: 'bbb' };
        expect(imageSides(changeSides({ ...png, area: 'staged' }), added).old).toBeNull();
        const deleted = { ...blobs, kind: 'deleted' as const, newBlob: null };
        expect(imageSides(changeSides({ ...png, area: 'unstaged' }), deleted).new).toBeNull();
        expect(imageSides(commitSides({ sha: 'c2', parent: 'c1' }, png), deleted).new).toBeNull();
        expect(imageSides(commitSides({ sha: 'c1', parent: null }, png), added).old).toBeNull();
    });
});
