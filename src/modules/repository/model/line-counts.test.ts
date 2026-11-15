import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/shared/i18n';
import { countsText } from './line-counts';

const it_ = createTranslator('it', 'it');
const en = createTranslator('en', 'en');

describe('countsText', () => {
    it('names a binary file in the UI language', () => {
        const binary = { additions: null, deletions: null, binary: true };
        expect(countsText(binary, it_)).toEqual({ kind: 'binary', text: 'binario' });
        expect(countsText(binary, en)).toEqual({ kind: 'binary', text: 'binary' });
    });

    it('is a dash for lines not counted', () => {
        const notCounted = { additions: null, deletions: null, binary: false };
        expect(countsText(notCounted, en)).toEqual({ kind: 'notCounted', text: '—' });
    });

    it('signs the lines, kept short when compact, a side not counted as none', () => {
        const lines = { additions: 1_234, deletions: null, binary: false };
        expect(countsText(lines, en)).toEqual({ kind: 'lines', added: '+1234', removed: '−0' });
        expect(countsText(lines, en, true)).toEqual({
            kind: 'lines',
            added: '+1.2k',
            removed: '−0',
        });
    });
});
