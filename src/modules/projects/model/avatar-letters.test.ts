import { describe, expect, it } from 'vitest';
import { writtenLetters } from './avatar-letters';

describe('writtenLetters', () => {
    it('keeps one or two letters or digits, trimmed, and none for blank', () => {
        expect(writtenLetters(' sw ')).toBe('sw');
        expect(writtenLetters('É2')).toBe('É2');
        expect(writtenLetters('  ')).toBeNull();
        expect(writtenLetters('abc')).toBe(false);
        expect(writtenLetters('a-')).toBe(false);
        expect(writtenLetters('🙂')).toBe(false);
    });
});
