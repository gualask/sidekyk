import { describe, expect, it } from 'vitest';
import { highlightParts } from './highlight-parts';

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
