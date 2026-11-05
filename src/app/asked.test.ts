import { describe, expect, it } from 'vitest';
import { type Asked, taken, targetFor } from './asked';

const FILE: Asked = { project: 'shop', folder: 'f1', panel: 'files', target: { key: 'a.ts' } };
const NOTE: Asked = { project: 'shop', folder: null, panel: 'notes', target: { key: 'note' } };

describe('a panel request', () => {
    it('reaches only the panel asked for, of its project and folder', () => {
        expect(targetFor(FILE, { project: 'shop', folder: 'f1', panel: 'files' })).toBe(
            FILE.target,
        );
        expect(targetFor(FILE, { project: 'shop', folder: 'f1', panel: 'changes' })).toBeNull();
        expect(targetFor(FILE, { project: 'docs', folder: 'f1', panel: 'files' })).toBeNull();
        // another folder of the project on screen: its path may not be there
        expect(targetFor(FILE, { project: 'shop', folder: 'f2', panel: 'files' })).toBeNull();
        expect(targetFor(null, { project: 'shop', folder: 'f1', panel: 'files' })).toBeNull();
    });

    it('for no folder in particular, reaches the panel whichever folder shows', () => {
        expect(targetFor(NOTE, { project: 'shop', folder: 'f2', panel: 'notes' })).toBe(
            NOTE.target,
        );
        expect(targetFor(NOTE, { project: 'shop', folder: null, panel: 'notes' })).toBe(
            NOTE.target,
        );
    });

    it('goes once taken, not when an older one is', () => {
        expect(taken(FILE, FILE.target)).toBeNull();
        // the same file asked again is another request
        expect(taken(FILE, { key: 'a.ts' })).toBe(FILE);
        expect(taken(null, FILE.target)).toBeNull();
    });
});
