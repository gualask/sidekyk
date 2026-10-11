import { describe, expect, it } from 'vitest';
import { fileKey, groupFiles, orderedFiles, splitPath } from './file-groups';
import type { ChangedFile } from './repository.types';

function file(path: string, area: ChangedFile['area']): ChangedFile {
    return {
        path,
        origPath: null,
        area,
        kind: area === 'untracked' ? 'untracked' : 'modified',
        additions: 1,
        deletions: 0,
        binary: false,
    };
}

describe('file groups', () => {
    const files = [
        file('z.ts', 'staged'),
        file('b.ts', 'unstaged'),
        file('new.md', 'untracked'),
        file('a.ts', 'unstaged'),
    ];

    it('orders areas as changes, new files, staged and sorts paths inside each', () => {
        expect(groupFiles(files).map((g) => [g.label, g.files.map((f) => f.path)])).toEqual([
            ['Changes', ['a.ts', 'b.ts']],
            ['New files', ['new.md']],
            ['Staged', ['z.ts']],
        ]);
    });

    it('drops empty areas', () => {
        expect(groupFiles([file('a.ts', 'staged')]).map((g) => g.area)).toEqual(['staged']);
    });

    it('lists files in the order the sidebar shows them', () => {
        expect(orderedFiles(files).map(fileKey)).toEqual([
            'unstaged:a.ts',
            'unstaged:b.ts',
            'untracked:new.md',
            'staged:z.ts',
        ]);
    });

    it('splits a path into name and folder', () => {
        expect(splitPath('src/app/App.tsx')).toEqual({ name: 'App.tsx', dir: 'src/app' });
        expect(splitPath('README.md')).toEqual({ name: 'README.md', dir: '' });
    });
});
