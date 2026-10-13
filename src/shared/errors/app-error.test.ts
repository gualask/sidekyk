import { describe, expect, it } from 'vitest';
import { errorMessage, hasErrorCode } from './app-error';

describe('errorMessage', () => {
    it('maps known codes and falls back to the backend message', () => {
        expect(errorMessage({ code: 'not_a_repository', message: 'not_a_repository' })).toBe(
            'That folder is not inside a git repository.',
        );
        expect(errorMessage({ code: 'unknown', message: 'git status exited with code 128' })).toBe(
            'git status exited with code 128',
        );
    });

    it('reads plain errors and strings', () => {
        expect(errorMessage(new Error('boom'))).toBe('boom');
        expect(errorMessage('denied')).toBe('denied');
    });
});

describe('hasErrorCode', () => {
    it('matches the code of a native error only', () => {
        const missing = { code: 'repository_missing', message: 'repository_missing' };
        expect(hasErrorCode(missing, 'repository_missing')).toBe(true);
        expect(hasErrorCode(missing, 'not_a_repository')).toBe(false);
        expect(hasErrorCode(new Error('repository_missing'), 'repository_missing')).toBe(false);
    });
});
