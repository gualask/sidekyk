import { describe, expect, it } from 'vitest';
import { copyLabel } from './use-copy-to-clipboard';

describe('copyLabel', () => {
    it('names the action until used, then says whether it worked', () => {
        expect(copyLabel(null, 'Copy hunk')).toBe('Copy hunk');
        expect(copyLabel({ id: 'a', ok: true }, 'Copy hunk')).toBe('Copied');
        expect(copyLabel({ id: 'a', ok: false }, 'Copy hunk')).toBe('Copy failed');
    });
});
