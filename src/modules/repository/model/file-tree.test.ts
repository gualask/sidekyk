import { describe, expect, it } from 'vitest';
import {
    changeMarks,
    foldersAbove,
    foldersToRead,
    type TreeRow,
    treeMove,
    treeRows,
} from './file-tree';
import type { ChangedFile, Directory } from './repository.types';

const DIRECTORIES: Record<string, Directory> = {
    '': {
        entries: [
            { name: 'src/modules', path: 'src/modules', folder: true },
            { name: 'docs', path: 'docs', folder: true },
            { name: 'README.md', path: 'README.md', folder: false },
        ],
        more: 0,
        truncated: false,
    },
    'src/modules': {
        entries: [
            { name: 'cart', path: 'src/modules/cart', folder: true },
            { name: 'index.ts', path: 'src/modules/index.ts', folder: false },
        ],
        more: 2,
        truncated: false,
    },
    'src/modules/cart': {
        entries: [{ name: 'total.ts', path: 'src/modules/cart/total.ts', folder: false }],
        more: 0,
        truncated: false,
    },
};

const read = (path: string) => DIRECTORIES[path];

function shown(rows: readonly TreeRow[]): string[] {
    return rows.map((row) =>
        row.kind === 'more'
            ? `${'  '.repeat(row.depth)}+${row.count}`
            : `${'  '.repeat(row.depth)}${row.name}${row.kind === 'folder' && row.open ? '/' : ''}`,
    );
}

describe('treeRows', () => {
    it('lists the open folders under their folder, and what a large one leaves out', () => {
        const open = new Set(['src/modules', 'src/modules/cart']);
        expect(shown(treeRows(open, read))).toEqual([
            'src/modules/',
            '  cart/',
            '    total.ts',
            '  index.ts',
            '  +2',
            'docs',
            'README.md',
        ]);
    });

    it('shows nothing inside a folder not read yet', () => {
        expect(shown(treeRows(new Set(['docs']), read))).toEqual([
            'src/modules',
            'docs/',
            'README.md',
        ]);
    });

    it('reads only the open folders that show', () => {
        expect(foldersToRead(new Set(['src/modules/cart']), read)).toEqual(['']);
        expect(foldersToRead(new Set(['src/modules', 'src/modules/cart', 'docs']), read)).toEqual([
            '',
            'src/modules',
            'src/modules/cart',
            'docs',
        ]);
    });
});

describe('foldersAbove', () => {
    it('names every folder above a path, outermost first', () => {
        expect(foldersAbove('src/modules/cart/total.ts')).toEqual([
            'src',
            'src/modules',
            'src/modules/cart',
        ]);
        expect(foldersAbove('README.md')).toEqual([]);
    });
});

describe('changeMarks', () => {
    const file = (path: string, kind: ChangedFile['kind']): ChangedFile => ({
        path,
        origPath: null,
        area: kind === 'untracked' ? 'untracked' : 'unstaged',
        kind,
        additions: 1,
        deletions: 0,
        binary: false,
    });

    it('marks files and the folders above them, an edit over a new file', () => {
        const marks = changeMarks([
            file('src/cart/new.ts', 'untracked'),
            file('src/cart/total.ts', 'modified'),
            file('src/util/fresh.ts', 'untracked'),
            file('old/gone.ts', 'deleted'),
        ]);
        expect(Object.fromEntries(marks)).toEqual({
            'src/cart/new.ts': 'added',
            'src/cart/total.ts': 'modified',
            'src/cart': 'modified',
            src: 'modified',
            'src/util/fresh.ts': 'added',
            'src/util': 'added',
        });
    });
});

describe('treeMove', () => {
    const open = new Set(['src/modules']);
    const rows = treeRows(open, read);

    it('moves up and down, past what a folder does not list', () => {
        expect(treeMove(rows, null, 'j')).toEqual({
            kind: 'select',
            path: 'src/modules',
            folder: true,
        });
        expect(treeMove(rows, 'src/modules/index.ts', 'ArrowDown')).toEqual({
            kind: 'select',
            path: 'docs',
            folder: true,
        });
        expect(treeMove(rows, 'docs', 'k')).toEqual({
            kind: 'select',
            path: 'src/modules/index.ts',
            folder: false,
        });
        expect(treeMove(rows, 'README.md', 'ArrowDown')).toBeNull();
    });

    it('opens a folder, then goes into it; closes it, then goes up', () => {
        expect(treeMove(rows, 'src/modules/cart', 'ArrowRight')).toEqual({
            kind: 'toggle',
            path: 'src/modules/cart',
        });
        expect(treeMove(rows, 'src/modules', 'ArrowRight')).toEqual({
            kind: 'select',
            path: 'src/modules/cart',
            folder: true,
        });
        expect(treeMove(rows, 'src/modules/index.ts', 'ArrowLeft')).toEqual({
            kind: 'select',
            path: 'src/modules',
            folder: true,
        });
        expect(treeMove(rows, 'src/modules', 'ArrowLeft')).toEqual({
            kind: 'toggle',
            path: 'src/modules',
        });
        expect(treeMove(rows, 'docs', 'ArrowLeft')).toBeNull();
    });

    it('opens a file, or opens and closes a folder', () => {
        expect(treeMove(rows, 'README.md', 'Enter')).toEqual({ kind: 'open', path: 'README.md' });
        expect(treeMove(rows, 'docs', 'Enter')).toEqual({ kind: 'toggle', path: 'docs' });
        expect(treeMove(rows, 'docs', ' ')).toEqual({ kind: 'toggle', path: 'docs' });
        expect(treeMove(rows, 'README.md', 'x')).toBeNull();
    });
});
