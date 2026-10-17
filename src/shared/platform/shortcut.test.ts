import { describe, expect, it } from 'vitest';
import { hasShortcutModifier, shortcutKey, shortcutLabel } from './shortcut';

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

    it('names the key of a shortcut, lowercased, and nothing else', () => {
        const key = (key: string, mods: { ctrlKey?: boolean; altKey?: boolean } = {}) =>
            shortcutKey({ metaKey: false, ctrlKey: false, altKey: false, key, ...mods });
        expect(key('F', { ctrlKey: true })).toBe('f');
        expect(key(',', { ctrlKey: true })).toBe(',');
        expect(key('f')).toBeNull();
        // AltGr comes as Ctrl+Alt, and types characters
        expect(key('[', { ctrlKey: true, altKey: true })).toBeNull();
    });
});
