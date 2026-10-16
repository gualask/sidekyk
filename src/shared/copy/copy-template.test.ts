import { describe, expect, it } from 'vitest';
import { DEFAULT_COPY_TEMPLATE, fillCopyTemplate, isCopyTemplate } from './copy-template';

describe('copy template', () => {
    it('fills every placeholder once', () => {
        const values = { row: 'src/a.ts:3', text: 'const row = "{row}";' };
        expect(fillCopyTemplate(DEFAULT_COPY_TEMPLATE, values)).toBe(
            'src/a.ts:3\nconst row = "{row}";',
        );
        expect(fillCopyTemplate('Check {row} -> {text} ({row})', values)).toBe(
            'Check src/a.ts:3 -> const row = "{row}"; (src/a.ts:3)',
        );
    });

    it('needs a placeholder', () => {
        expect(isCopyTemplate(DEFAULT_COPY_TEMPLATE)).toBe(true);
        expect(isCopyTemplate('{text}')).toBe(true);
        expect(isCopyTemplate('Look at this')).toBe(false);
        expect(isCopyTemplate('{ row }')).toBe(false);
    });
});
