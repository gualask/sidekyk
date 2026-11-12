import { describe, expect, it } from 'vitest';
import { sparklineArea, sparklinePath } from './sparkline';

const BOX = { width: 60, height: 24, inset: 1 };

/** The y of every point and control point of a path. */
function ys(path: string): number[] {
    const numbers = path.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    return numbers.filter((_, index) => index % 2 === 1);
}

describe('sparklinePath', () => {
    it('goes through each value at even steps, the busiest at the top', () => {
        expect(sparklinePath([0, 10, 5], BOX)).toBe('M0 23 C10 23 20 1 30 1 C40 1 50 12 60 12');
    });

    it('stays flat on the baseline for a week without lines', () => {
        expect(new Set(ys(sparklinePath([0, 0, 0, 0], BOX)))).toEqual(new Set([23]));
    });

    it('never dips under the baseline nor peaks past the busiest day', () => {
        for (const values of [
            [0, 100, 0, 0, 3, 0, 80],
            [5, 0, 200, 190, 0, 0, 1],
            [0, 0, 0, 1000, 0, 0, 0],
        ]) {
            for (const y of ys(sparklinePath(values, BOX))) {
                expect(y).toBeGreaterThanOrEqual(1);
                expect(y).toBeLessThanOrEqual(23);
            }
        }
    });

    it('closes the area down to the bottom of the box', () => {
        expect(sparklineArea('M0 23 C10 23 20 1 30 1', BOX)).toBe(
            'M0 23 C10 23 20 1 30 1 L60 24 L0 24 Z',
        );
    });
});
