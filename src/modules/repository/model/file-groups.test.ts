import { describe, expect, it } from 'vitest';
import {
    changeOf,
    fileKey,
    fileListRows,
    groupFiles,
    orderedFiles,
    splitPath,
} from './file-groups';
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
            ['changes.group.unstaged', ['a.ts', 'b.ts']],
            ['changes.group.untracked', ['new.md']],
            ['changes.group.staged', ['z.ts']],
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

    it('flattens the groups into headings followed by their files', () => {
        expect(
            fileListRows(files).map((row) =>
                row.kind === 'group'
                    ? `${row.label} (${row.count})${row.first ? ' first' : ''}`
                    : fileKey(row.file),
            ),
        ).toEqual([
            'changes.group.unstaged (2) first',
            'unstaged:a.ts',
            'unstaged:b.ts',
            'changes.group.untracked (1)',
            'untracked:new.md',
            'changes.group.staged (1)',
            'staged:z.ts',
        ]);
    });

    it('splits a path into name and folder', () => {
        expect(splitPath('src/app/App.tsx')).toEqual({ name: 'App.tsx', dir: 'src/app' });
        expect(splitPath('README.md')).toEqual({ name: 'README.md', dir: '' });
    });
});

describe('changeOf', () => {
    it('finds the change a path shows first, a deletion only when it is the only one', () => {
        const ordered = orderedFiles([
            file('a.ts', 'staged'),
            file('a.ts', 'unstaged'),
            { ...file('gone.ts', 'unstaged'), kind: 'deleted' },
            { ...file('back.ts', 'staged'), kind: 'deleted' },
            file('back.ts', 'untracked'),
        ]);
        expect(changeOf(ordered, 'a.ts')?.area).toBe('unstaged');
        expect(changeOf(ordered, 'gone.ts')?.kind).toBe('deleted');
        expect(changeOf(ordered, 'back.ts')?.area).toBe('untracked');
        expect(changeOf(ordered, 'other.ts')).toBeNull();
    });
});
