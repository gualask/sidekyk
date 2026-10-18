import { describe, expect, it } from 'vitest';
import { placeName, remoteName } from './project-place';

describe('remoteName', () => {
    it('names the distro of a WSL project, nothing for a local one', () => {
        expect(remoteName({ kind: 'wsl', distro: 'Ubuntu', root: '/home/ale/shop' })).toBe(
            'WSL: Ubuntu',
        );
        expect(remoteName({ kind: 'local', root: '/Users/ale/shop' })).toBeNull();
    });
});

describe('placeName', () => {
    it('is the folder, with its machine when not this one', () => {
        expect(placeName({ kind: 'wsl', distro: 'Ubuntu', root: '/home/ale/shop' })).toBe(
            '/home/ale/shop (WSL: Ubuntu)',
        );
        expect(placeName({ kind: 'local', root: '/Users/ale/shop' })).toBe('/Users/ale/shop');
    });
});
