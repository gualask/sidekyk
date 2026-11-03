import { describe, expect, it } from 'vitest';
import {
    freeRepositories,
    isParent,
    type ParentFolder,
    parentFolders,
    withFolder,
} from './new-project';

const location = (root: string) => ({ kind: 'local', root }) as const;

const parent: ParentFolder = {
    kind: 'usable',
    path: '/dev/shop',
    name: 'shop',
    location: location('/dev/shop'),
    repositories: [
        {
            path: '/dev/shop/api',
            name: 'api',
            location: location('/dev/shop/api'),
            inProject: null,
        },
        {
            path: '/dev/shop/ops',
            name: 'ops',
            location: location('/dev/shop/ops'),
            inProject: 'Ops',
        },
        {
            path: '/dev/shop/web',
            name: 'web',
            location: location('/dev/shop/web'),
            inProject: null,
        },
    ],
};

describe('a parent of repositories', () => {
    it('offers only the repositories no project has', () => {
        expect(freeRepositories(parent).map((r) => r.name)).toEqual(['api', 'web']);
        expect(isParent(parent)).toBe(true);
        const taken = { ...parent, repositories: parent.repositories.slice(1, 2) };
        expect(isParent(taken)).toBe(false);
    });

    it('brings its free repositories, or itself', () => {
        expect(parentFolders(parent, 'together').map((f) => f.path)).toEqual([
            '/dev/shop/api',
            '/dev/shop/web',
        ]);
        expect(parentFolders(parent, 'folder')).toEqual([
            { path: '/dev/shop', location: location('/dev/shop') },
        ]);
    });
});

describe('the folders picked', () => {
    it('take a folder once', () => {
        const api = { path: '/dev/api', location: location('/dev/api') };
        expect(withFolder([], api)).toEqual([api]);
        expect(withFolder([api], api)).toEqual([api]);
    });
});
