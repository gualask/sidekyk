import { describe, expect, it } from 'vitest';
import type { ChangedFile } from './repository.types';
import { FIRST_CHANGE, selectedFile, selectionOf } from './selection';
import { orderedFiles } from './tree/file-groups';

function file(path: string, kind: ChangedFile['kind'] = 'modified'): ChangedFile {
    return {
        path,
        origPath: null,
        area: 'unstaged',
        kind,
        additions: 1,
        deletions: 0,
        binary: false,
        oldBlob: null,
        newBlob: null,
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
        const path = (name: string) => ({
            kind: 'path' as const,
            path: name,
            back: null,
            lines: null,
        });
        expect(selectedFile(path('b.ts'), ordered).change?.path).toBe('b.ts');
        expect(selectedFile(path('README.md'), ordered)).toEqual({
            change: null,
            path: 'README.md',
            lines: null,
        });
    });

    it('remembers the change to go back to across files of the tree', () => {
        const first = selectionOf('x', { kind: 'change', key: 'unstaged:a.ts' });
        expect(selectionOf('y', first)).toEqual({
            kind: 'path',
            path: 'y',
            back: 'unstaged:a.ts',
            lines: null,
        });
    });

    it('keeps the lines a note named until another file is picked', () => {
        const named = selectionOf('a.ts', FIRST_CHANGE, { first: 3, last: 5 });
        expect(selectedFile(named, ordered).lines).toEqual({ first: 3, last: 5 });
        expect(selectedFile(selectionOf('b.ts', named), ordered).lines).toBeNull();
        expect(selectedFile({ kind: 'change', key: 'unstaged:b.ts' }, ordered).lines).toBeNull();
        // a deleted file shows no lines
        const gone = selectionOf('gone.ts', FIRST_CHANGE, { first: 1, last: 1 });
        expect(selectedFile(gone, ordered).lines).toBeNull();
    });
});
