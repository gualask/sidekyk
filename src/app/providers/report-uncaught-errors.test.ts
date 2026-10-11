import { describe, expect, it } from 'vitest';
import { describeError } from './report-uncaught-errors';

describe('describeError', () => {
    it('keeps the name and the message ahead of the stack', () => {
        const error = new TypeError('boom');
        error.stack = 'at render (App.tsx:1:1)';
        expect(describeError(error)).toBe('TypeError: boom\nat render (App.tsx:1:1)');
    });

    it('describes values that are not errors', () => {
        expect(describeError('plain')).toBe('plain');
        expect(describeError(undefined)).toBe('undefined');
    });
});
