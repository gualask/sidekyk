import { describe, expect, it } from 'vitest';
import { contentRows, highlightParts, paletteRows } from './palette-rows';

const PANELS = [{ id: 'changes', title: 'Changes', shortcut: '1' }];

describe('paletteRows', () => {
    it('puts the items under their groups and leaves empty groups out', () => {
        const { items, rows } = paletteRows(
            {
                projects: [{ id: '/dev/shop', name: 'shop', highlights: [] }],
                panels: [],
                files: [{ path: 'src/total.ts', mark: 'modified', highlights: [[4, 7]] }],
                moreFiles: 3,
                lists: [],
                notes: [],
            },
            PANELS,
            'shop',
        );
        expect(items.map((item) => item.label)).toEqual(['shop', 'src/total.ts']);
        expect(rows).toEqual([
            { kind: 'group', label: 'Projects' },
            { kind: 'item', item: items[0], index: 0 },
            { kind: 'group', label: 'Files in shop' },
            { kind: 'item', item: items[1], index: 1 },
            { kind: 'more', count: 3 },
        ]);
    });

    it('puts lists and notes before files, a note by its first line or the text found', () => {
        const { items, rows } = paletteRows(
            {
                projects: [],
                panels: [],
                files: [{ path: 'notes.md', mark: null, highlights: [] }],
                moreFiles: 0,
                lists: [{ id: 'l1', name: 'Release', highlights: [[0, 2]] }],
                notes: [
                    {
                        id: 'n1',
                        list: 'l1',
                        listName: 'Release',
                        title: 'Bump version',
                        highlights: [[0, 2]],
                        snippet: null,
                        done: false,
                    },
                    {
                        id: 'n2',
                        list: 'l1',
                        listName: 'Release',
                        title: 'Smoke test',
                        highlights: [],
                        snippet: { text: '…the downloads…', highlights: [[5, 14]] },
                        done: true,
                    },
                ],
            },
            PANELS,
            'shop',
        );
        expect(rows.flatMap((row) => (row.kind === 'group' ? [row.label] : []))).toEqual([
            'Note lists in shop',
            'Notes in shop',
            'Files in shop',
        ]);
        expect(items[2]).toEqual({
            kind: 'note',
            id: 'n2',
            list: 'l1',
            hint: 'Release · done',
            label: '…the downloads…',
            highlights: [[5, 14]],
        });
    });

    it('names a panel by its definition and skips one it does not know', () => {
        const { items } = paletteRows(
            {
                projects: [],
                panels: [
                    { index: 0, highlights: [[0, 2]] },
                    { index: 5, highlights: [] },
                ],
                files: [],
                moreFiles: 0,
                lists: [],
                notes: [],
            },
            PANELS,
            'shop',
        );
        expect(items).toEqual([
            {
                kind: 'panel',
                id: 'changes',
                shortcut: '1',
                label: 'Changes',
                highlights: [[0, 2]],
            },
        ]);
    });
});

describe('highlightParts', () => {
    it('cuts a text at its highlights', () => {
        expect(
            highlightParts('src/total.ts', [
                [4, 7],
                [10, 12],
            ]),
        ).toEqual([
            { text: 'src/', start: 0, matched: false },
            { text: 'tot', start: 4, matched: true },
            { text: 'al.', start: 7, matched: false },
            { text: 'ts', start: 10, matched: true },
        ]);
        expect(highlightParts('shop', [])).toEqual([{ text: 'shop', start: 0, matched: false }]);
    });
});

describe('contentRows', () => {
    const line = (number: number) => ({ number, text: `line ${number}`, highlights: [] });
    const files = [
        { path: 'a.ts', lines: [line(1)] },
        { path: 'b.ts', lines: [line(3), line(9)] },
    ];

    it('lists the lines under their files', () => {
        const { items, rows } = contentRows(files, null);
        expect(items.map((item) => item.label)).toEqual(['line 1', 'line 3', 'line 9']);
        expect(rows.map((row) => row.kind)).toEqual(['file', 'item', 'file', 'item', 'item']);
        expect(rows[2]).toEqual({ kind: 'file', path: 'b.ts', count: 2 });
    });

    it('puts the lines of the file shown first', () => {
        const { items, rows } = contentRows(files, 'b.ts');
        expect(items.map((item) => item.label)).toEqual(['line 3', 'line 9', 'line 1']);
        expect(rows.slice(0, 1)).toEqual([{ kind: 'group', label: 'In this file' }]);
        expect(rows[3]).toEqual({ kind: 'group', label: 'Other files' });
        expect(rows[4]).toEqual({ kind: 'file', path: 'a.ts', count: 1 });
    });
});
