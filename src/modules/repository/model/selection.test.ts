import { describe, expect, it } from 'vitest';
import { orderedFiles } from './file-groups';
import type { ChangedFile } from './repository.types';
import { FIRST_CHANGE, selectedFile, selectionOf } from './selection';

function file(path: string, kind: ChangedFile['kind'] = 'modified'): ChangedFile {
    return {
        path,
        origPath: null,
        area: 'unstaged',
        kind,
        additions: 1,
        deletions: 0,
        binary: false,
    };
}

const ordered = orderedFiles([file('b.ts'), file('a.ts'), file('gone.ts', 'deleted')]);

describe('selection', () => {
    it('shows the first change until one is picked, and its path in the tree', () => {
        const shown = selectedFile(FIRST_CHANGE, ordered);
        expect(shown.change?.path).toBe('a.ts');
        expect(shown.path).toBe('a.ts');
        expect(selectedFile({ kind: 'change', key: 'unstaged:left.ts' }, ordered).path).toBe(
            'a.ts',
        );
    });

    it('reveals no path for a deleted file', () => {
        const shown = selectedFile({ kind: 'change', key: 'unstaged:gone.ts' }, ordered);
        expect(shown.change?.path).toBe('gone.ts');
        expect(shown.path).toBeNull();
    });

    it('shows a path of the tree as a change while it is one', () => {
        expect(selectedFile({ kind: 'path', path: 'b.ts', back: null }, ordered).change?.path).toBe(
            'b.ts',
        );
        expect(selectedFile({ kind: 'path', path: 'README.md', back: null }, ordered)).toEqual({
            change: null,
            path: 'README.md',
        });
    });

    it('remembers the change to go back to across files of the tree', () => {
        const first = selectionOf('x', { kind: 'change', key: 'unstaged:a.ts' });
        expect(selectionOf('y', first)).toEqual({
            kind: 'path',
            path: 'y',
            back: 'unstaged:a.ts',
        });
    });
});
