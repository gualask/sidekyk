import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/shared/i18n';
import type { RepositorySummary } from '../repository.types';
import {
    changedCount,
    changedLabel,
    compactCount,
    summedTotals,
    trackedLinesChanged,
} from './summary';

const summary = (files: number, truncated: boolean): RepositorySummary => ({
    branch: { head: 'main', commit: 'abc1234', upstream: null, ahead: 0, behind: 0 },
    totals: { files, additions: 0, deletions: 0 },
    truncated,
});

describe('changedCount', () => {
    it('says when there are more changes than were read', () => {
        expect(changedCount(summary(12, false))).toBe('12');
        expect(changedCount(summary(1_234, false))).toBe('1.2k');
        expect(changedCount(summary(10_000, true))).toBe('10k+');
    });
});

describe('compactCount', () => {
    it('keeps a count of lines within four characters, never above what it is', () => {
        expect(compactCount(340)).toBe('340');
        expect(compactCount(999)).toBe('999');
        expect(compactCount(1_000)).toBe('1k');
        expect(compactCount(1_299)).toBe('1.2k');
        expect(compactCount(48_700)).toBe('48k');
        expect(compactCount(999_999)).toBe('999k');
        expect(compactCount(1_250_000)).toBe('1.2M');
    });
});

describe('summedTotals', () => {
    it("adds several repositories' changes, cut when one is", () => {
        const api = { totals: { files: 3, additions: 40, deletions: 12 }, truncated: false };
        const web = { totals: { files: 1, additions: 8, deletions: 2 }, truncated: true };
        expect(summedTotals([api, web])).toEqual({
            totals: { files: 4, additions: 48, deletions: 14 },
            truncated: true,
        });
        expect(changedCount(summedTotals([api, web]))).toBe('4+');
        expect(summedTotals([])).toEqual({
            totals: { files: 0, additions: 0, deletions: 0 },
            truncated: false,
        });
    });
});

describe('changedLabel', () => {
    const en = createTranslator('en', 'en');
    it('says what changed, or clean', () => {
        const totals = (files: number) => ({
            totals: { files, additions: 0, deletions: 0 },
            truncated: false,
        });
        expect(changedLabel(totals(0), en)).toBe('clean');
        expect(changedLabel(totals(8), en)).toBe('8 changed');
    });
});

describe('trackedLinesChanged', () => {
    const changed = (files: number, additions: number, deletions: number) => ({
        totals: { files, additions, deletions },
        truncated: false,
    });

    it('is true once a line of a tracked file was added or removed', () => {
        expect(trackedLinesChanged(changed(2, 3, 0))).toBe(true);
        expect(trackedLinesChanged(changed(1, 0, 4))).toBe(true);
    });

    it('is false for new or binary files alone, and when clean', () => {
        expect(trackedLinesChanged(changed(3, 0, 0))).toBe(false);
        expect(trackedLinesChanged(changed(0, 0, 0))).toBe(false);
    });
});
