import { describe, expect, it } from 'vitest';
import { highlightParts, paletteRows } from './palette-rows';

const PANELS = [{ id: 'changes', title: 'Changes', shortcut: '1' }];

describe('paletteRows', () => {
    it('puts the items under their groups and leaves empty groups out', () => {
        const { items, rows } = paletteRows(
            {
                projects: [{ root: '/dev/shop', name: 'shop', highlights: [] }],
                panels: [],
                files: [{ path: 'src/total.ts', mark: 'modified', highlights: [[4, 7]] }],
                moreFiles: 3,
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
