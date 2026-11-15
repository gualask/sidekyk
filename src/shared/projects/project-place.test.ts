import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/shared/i18n';
import { placeName, remoteMachine, remoteName } from './project-place';

const en = createTranslator('en', 'en');

describe('remoteMachine', () => {
    it('is the distro of a WSL project, nothing for a local one', () => {
        expect(remoteMachine({ kind: 'wsl', distro: 'Ubuntu', root: '/home/ale/shop' })).toBe(
            'Ubuntu',
        );
        expect(remoteMachine({ kind: 'local', root: '/Users/ale/shop' })).toBeNull();
    });
});

describe('remoteName', () => {
    it('names the distro of a WSL project, nothing for a local one', () => {
        expect(remoteName({ kind: 'wsl', distro: 'Ubuntu', root: '/home/ale/shop' }, en)).toBe(
            'WSL: Ubuntu',
        );
        expect(remoteName({ kind: 'local', root: '/Users/ale/shop' }, en)).toBeNull();
    });
});

describe('placeName', () => {
    it('is the folder, with its machine when not this one', () => {
        expect(placeName({ kind: 'wsl', distro: 'Ubuntu', root: '/home/ale/shop' }, en)).toBe(
            '/home/ale/shop (WSL: Ubuntu)',
        );
        expect(placeName({ kind: 'local', root: '/Users/ale/shop' }, en)).toBe('/Users/ale/shop');
    });
});
