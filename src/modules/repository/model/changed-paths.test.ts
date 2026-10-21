import { describe, expect, it } from 'vitest';
import { changeTouches } from './changed-paths';

describe('changed paths', () => {
    it('touch the same path, a folder holding it or a path inside it', () => {
        expect(changeTouches(['src/cart.ts'], 'src/cart.ts')).toBe(true);
        expect(changeTouches(['src'], 'src/cart.ts')).toBe(true);
        expect(changeTouches(['vendor/lib/a.c'], 'vendor/lib')).toBe(true);
    });

    it('leave other paths alone, a name that only begins the same included', () => {
        expect(changeTouches(['src/cart.ts'], 'src/order.ts')).toBe(false);
        expect(changeTouches(['src/cart'], 'src/cart.ts')).toBe(false);
        expect(changeTouches(['src/cart.ts'], 'src/cart')).toBe(false);
        expect(changeTouches([], 'src/cart.ts')).toBe(false);
    });

    it('touch everything when unknown, and ignore letter case', () => {
        expect(changeTouches(null, 'src/cart.ts')).toBe(true);
        expect(changeTouches(['SRC/Cart.ts'], 'src/cart.ts')).toBe(true);
    });
});
