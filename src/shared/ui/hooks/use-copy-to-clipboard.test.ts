import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/shared/i18n';
import { copyLabel } from './use-copy-to-clipboard';

const en = createTranslator('en', 'en');

describe('copyLabel', () => {
    it('names the action until used, then says whether it worked', () => {
        expect(copyLabel(null, 'Copy hunk', en)).toBe('Copy hunk');
        expect(copyLabel({ id: 'a', ok: true }, 'Copy hunk', en)).toBe('Copied');
        expect(copyLabel({ id: 'a', ok: false }, 'Copy hunk', en)).toBe('Copy failed');
    });
});
