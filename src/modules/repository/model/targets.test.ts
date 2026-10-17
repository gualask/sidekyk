import { describe, expect, it } from 'vitest';
import { fileTarget, shownBy } from './targets';

describe('panel targets', () => {
    it('carry a path and the hunk to open on', () => {
        expect(shownBy(fileTarget('src/a.ts', 2))).toEqual({ path: 'src/a.ts', hunk: 2 });
        expect(shownBy(fileTarget('src/a.ts'))).toEqual({ path: 'src/a.ts', hunk: null });
    });

    it('read nothing from any other key', () => {
        expect(shownBy({ key: 'plain' })).toBeNull();
        expect(shownBy({ key: '{"hunk":1}' })).toBeNull();
        expect(shownBy({ key: '{"path":"a","hunk":"1"}' })).toBeNull();
    });
});
