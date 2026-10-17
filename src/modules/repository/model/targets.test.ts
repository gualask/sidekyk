import { describe, expect, it } from 'vitest';
import { changesTarget, fileTarget, shownBy } from './targets';

describe('panel targets', () => {
    it('carry a changed file, or a path and the hunk to open on', () => {
        expect(shownBy(changesTarget({ area: 'unstaged', path: 'src/a.ts' }))).toEqual({
            kind: 'change',
            key: 'unstaged:src/a.ts',
            hunk: null,
        });
        expect(shownBy(fileTarget('src/a.ts', 2))).toEqual({
            kind: 'path',
            path: 'src/a.ts',
            hunk: 2,
        });
    });

    it('read nothing from any other key', () => {
        expect(shownBy({ key: 'plain' })).toBeNull();
        expect(shownBy({ key: '{"kind":"path","hunk":1}' })).toBeNull();
        expect(shownBy({ key: '{"kind":"other","path":"a"}' })).toBeNull();
    });
});
