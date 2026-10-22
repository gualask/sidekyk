import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/shared/i18n';
import { contentRows, highlightParts, paletteRows } from './palette-rows';
import type { SearchResults } from './search.types';

const en = createTranslator('en', 'en');

const PANELS = [{ id: 'changes', title: 'Changes', icon: () => null, shortcut: '1' }];

const NONE: SearchResults = {
    projects: [],
    panels: [],
    files: [],
    moreFiles: 0,
    lists: [],
    notes: [],
};

const file = (path: string, score: number): SearchResults['files'][number] => ({
    path,
    mark: null,
    score,
    highlights: [],
});

const note = (id: string, score: number): SearchResults['notes'][number] => ({
    id,
    list: 'l1',
    listName: 'General',
    title: `Note ${id}`,
    score,
    highlights: [],
    snippet: null,
});

describe('paletteRows', () => {
    it('with nothing typed, puts the projects or the panels under their title', () => {
        const projects = paletteRows(
            {
                ...NONE,
                projects: [
                    {
                        id: '/dev/shop',
                        name: 'shop',
                        folders: [{ kind: 'local', root: '/dev/shop' }],
                        score: 0,
                        highlights: [],
                    },
                ],
            },
            [],
            null,
            false,
            en,
        );
        expect(projects.rows).toEqual([
            { kind: 'group', label: 'Projects' },
            { kind: 'item', item: projects.items[0], index: 0 },
        ]);

        const panels = paletteRows(
            { ...NONE, panels: [{ index: 0, score: 0, highlights: [] }] },
            PANELS,
            'shop',
            false,
            en,
        );
        expect(panels.rows.map((row) => (row.kind === 'group' ? row.label : row.kind))).toEqual([
            'Panels in shop',
            'item',
        ]);
    });

    it('typed, mixes the kinds by score, with no titles, the files left counted last', () => {
        const { items, rows } = paletteRows(
            {
                ...NONE,
                files: [file('db/seed.sql', 110)],
                moreFiles: 3,
                notes: [note('a', 60)],
            },
            PANELS,
            'shop',
            true,
            en,
        );
        expect(items.map((item) => item.label)).toEqual(['db/seed.sql', 'Note a']);
        expect(rows).toEqual([
            { kind: 'item', item: items[0], index: 0 },
            { kind: 'item', item: items[1], index: 1 },
            { kind: 'more', count: 3 },
        ]);
    });

    it('typed, puts the best two of each kind first, so many notes hide no file', () => {
        const { items } = paletteRows(
            {
                ...NONE,
                files: [file('src/watcher.rs', 80), file('src/watcher/filter.rs', 70)],
                notes: [note('a', 100), note('b', 95), note('c', 90), note('d', 85)],
            },
            PANELS,
            'shop',
            true,
            en,
        );
        expect(items.map((item) => item.label)).toEqual([
            'Note a',
            'Note b',
            'src/watcher.rs',
            'src/watcher/filter.rs',
            'Note c',
            'Note d',
        ]);
    });

    it('typed, breaks a tie by kind: a panel, a list, a file, then a note', () => {
        const { items } = paletteRows(
            {
                ...NONE,
                panels: [{ index: 0, score: 50, highlights: [] }],
                files: [file('changes.md', 50)],
                lists: [{ id: 'l1', name: 'Changes log', score: 50, highlights: [] }],
                notes: [note('a', 50)],
            },
            PANELS,
            'shop',
            true,
            en,
        );
        expect(items.map((item) => item.kind)).toEqual(['panel', 'list', 'file', 'note']);
    });

    it('shows a note by its first line, or by the part where the words are', () => {
        const { items } = paletteRows(
            {
                ...NONE,
                notes: [
                    { ...note('a', 60), title: 'Bump version', highlights: [[0, 4]] },
                    {
                        ...note('b', 50),
                        snippet: { text: '…the downloads…', highlights: [[5, 14]] },
                    },
                ],
            },
            PANELS,
            'shop',
            true,
            en,
        );
        expect(items[0]).toMatchObject({ label: 'Bump version', highlights: [[0, 4]] });
        expect(items[1]).toMatchObject({
            label: '…the downloads…',
            highlights: [[5, 14]],
            listName: 'General',
        });
    });

    it('names a panel by its definition and skips one it does not know', () => {
        const { items } = paletteRows(
            {
                ...NONE,
                panels: [
                    { index: 0, score: 40, highlights: [[0, 2]] },
                    { index: 5, score: 30, highlights: [] },
                ],
            },
            PANELS,
            'shop',
            true,
            en,
        );
        expect(items).toEqual([
            {
                kind: 'panel',
                id: 'changes',
                icon: PANELS[0].icon,
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
        const { items, rows } = contentRows(files, null, en);
        expect(items.map((item) => item.label)).toEqual(['line 1', 'line 3', 'line 9']);
        expect(rows.map((row) => row.kind)).toEqual(['file', 'item', 'file', 'item', 'item']);
        expect(rows[2]).toEqual({ kind: 'file', path: 'b.ts', count: 2 });
    });

    it('puts the lines of the file shown first', () => {
        const { items, rows } = contentRows(files, 'b.ts', en);
        expect(items.map((item) => item.label)).toEqual(['line 3', 'line 9', 'line 1']);
        expect(rows.slice(0, 1)).toEqual([{ kind: 'group', label: 'In this file' }]);
        expect(rows[3]).toEqual({ kind: 'group', label: 'Other files' });
        expect(rows[4]).toEqual({ kind: 'file', path: 'a.ts', count: 1 });
    });
});
