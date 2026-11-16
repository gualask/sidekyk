import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/shared/i18n';
import { contentRows } from './content-rows';

const en = createTranslator('en', 'en');

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
