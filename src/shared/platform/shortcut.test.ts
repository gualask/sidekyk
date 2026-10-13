import { describe, expect, it } from 'vitest';
import { hasShortcutModifier, shortcutLabel } from './shortcut';

// tests run outside macOS's user agent: shortcuts take `Ctrl`
describe('shortcuts off macOS', () => {
    const key = (modifiers: Partial<KeyboardEvent>) => ({ ...modifiers }) as KeyboardEvent;

    it('names the modifier in labels', () => {
        expect(shortcutLabel(',')).toBe('Ctrl+,');
    });

    it('takes Ctrl alone as the modifier', () => {
        expect(hasShortcutModifier(key({ ctrlKey: true, metaKey: false }))).toBe(true);
        expect(hasShortcutModifier(key({ ctrlKey: false, metaKey: true }))).toBe(false);
        expect(hasShortcutModifier(key({ ctrlKey: true, metaKey: true }))).toBe(false);
    });
});
