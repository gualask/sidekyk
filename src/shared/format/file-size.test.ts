import { describe, expect, it } from 'vitest';
import { fileSize } from './file-size';

describe('fileSize', () => {
    it('sizes files as file managers do', () => {
        expect(fileSize(858, 'en-GB')).toBe('858 byte');
        expect(fileSize(7874, 'en-GB')).toBe('7.9 kB');
        expect(fileSize(16_777_216, 'it-IT')).toBe('16,8 MB');
    });
});
