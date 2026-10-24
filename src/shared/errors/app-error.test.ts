import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/shared/i18n';
import { errorMessage, hasErrorCode } from './app-error';

const en = createTranslator('en', 'en');

describe('errorMessage', () => {
    it('maps known codes and falls back to the backend message', () => {
        expect(errorMessage({ code: 'file_missing', message: 'file_missing' }, en)).toBe(
            en.t('error.fileMissing'),
        );
        expect(
            errorMessage({ code: 'unknown', message: 'git status exited with code 128' }, en),
        ).toBe('git status exited with code 128');
        const it = createTranslator('it', 'it');
        expect(errorMessage({ code: 'file_missing', message: 'file_missing' }, it)).toBe(
            it.t('error.fileMissing'),
        );
    });

    it('reads plain errors and strings', () => {
        expect(errorMessage(new Error('boom'), en)).toBe('boom');
        expect(errorMessage('denied', en)).toBe('denied');
    });
});

describe('hasErrorCode', () => {
    it('matches the code of a native error only', () => {
        const missing = { code: 'repository_missing', message: 'repository_missing' };
        expect(hasErrorCode(missing, 'repository_missing')).toBe(true);
        expect(hasErrorCode(missing, 'file_missing')).toBe(false);
        expect(hasErrorCode(new Error('repository_missing'), 'repository_missing')).toBe(false);
    });
});
