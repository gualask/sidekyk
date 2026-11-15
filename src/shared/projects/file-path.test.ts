import { describe, expect, it } from 'vitest';
import { splitPath } from './file-path';

describe('splitPath', () => {
    it('splits a path into name and folder', () => {
        expect(splitPath('src/app/App.tsx')).toEqual({ name: 'App.tsx', dir: 'src/app' });
        expect(splitPath('README.md')).toEqual({ name: 'README.md', dir: '' });
    });
});
