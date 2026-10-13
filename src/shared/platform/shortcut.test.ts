import { describe, expect, it } from 'vitest';
import { hasShortcutModifier, shortcutLabel } from './shortcut';

// tests run outside macOS's user agent: shortcuts take `Ctrl`
describe('shortcuts off macOS', () => {
    it('names the modifier in labels', () => {
        expect(shortcutLabel(',')).toBe('Ctrl+,');
    });

    it('takes Ctrl alone as the modifier', () => {
        expect(hasShortcutModifier({ ctrlKey: true, metaKey: false })).toBe(true);
        expect(hasShortcutModifier({ ctrlKey: false, metaKey: true })).toBe(false);
        expect(hasShortcutModifier({ ctrlKey: true, metaKey: true })).toBe(false);
    });
});
