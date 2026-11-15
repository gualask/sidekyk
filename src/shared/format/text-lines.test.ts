import { describe, expect, it } from 'vitest';
import { splitLines } from './text-lines';

describe('splitLines', () => {
    it('ends the last line on its newline, with or without one', () => {
        expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
        expect(splitLines('a\nb')).toEqual(['a', 'b']);
        expect(splitLines('a\n\n')).toEqual(['a', '']);
    });

    it('has no line for an empty text, and keeps a CRLF line its \\r', () => {
        expect(splitLines('')).toEqual([]);
        expect(splitLines('a\r\nb\r\n')).toEqual(['a\r', 'b\r']);
    });
});
