import { describe, expect, it } from 'vitest';
import { changeStep, leftToTiles, listMove } from './keys';

describe('listMove', () => {
    it('moves with the arrows and Vim’s j/k, opens with ↵ and Space', () => {
        expect(['ArrowDown', 'j', 'ArrowUp', 'k', 'Enter', ' '].map(listMove)).toEqual([
            'next',
            'next',
            'previous',
            'previous',
            'open',
            'open',
        ]);
    });

    it('is nothing for any other key, an inherited name included', () => {
        expect(['J', 'ArrowLeft', 'n', 'toString'].map(listMove)).toEqual([null, null, null, null]);
    });
});

describe('leftToTiles', () => {
    it('leaves the arrows and ↵ to the workspace, the letters and Space to the list', () => {
        expect(['ArrowUp', 'ArrowLeft', 'Enter'].every(leftToTiles)).toBe(true);
        expect(['j', 'k', ' '].some(leftToTiles)).toBe(false);
    });
});

describe('changeStep', () => {
    it('steps forward on n, back on p', () => {
        expect(['n', 'p', 'N', 'j'].map(changeStep)).toEqual([1, -1, 0, 0]);
    });
});
