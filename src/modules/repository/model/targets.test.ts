import { describe, expect, it } from 'vitest';
import { fileTarget, shownBy } from './targets';

describe('panel targets', () => {
    it('carry a path, the hunk to open on and a text to look for', () => {
        expect(shownBy(fileTarget('src/a.ts', 2))).toEqual({
            path: 'src/a.ts',
            hunk: 2,
            find: null,
        });
        expect(shownBy(fileTarget('src/a.ts', null, { query: 'total', line: 12 }))).toEqual({
            path: 'src/a.ts',
            hunk: null,
            find: { query: 'total', line: 12 },
        });
    });

    it('read nothing from any other key', () => {
        expect(shownBy({ key: 'plain' })).toBeNull();
        expect(shownBy({ key: '{"hunk":1,"find":null}' })).toBeNull();
        expect(shownBy({ key: '{"path":"a","hunk":"1","find":null}' })).toBeNull();
        expect(shownBy({ key: '{"path":"a","hunk":null,"find":{"query":"x"}}' })).toBeNull();
    });
});
