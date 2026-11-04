import { describe, expect, it } from 'vitest';
import { keysLabel, withKeys } from './keys';

describe('keysLabel', () => {
    it('writes modifiers as macOS’s symbols there, in its order', () => {
        expect(keysLabel('Shift+Enter', true)).toBe('⇧↵');
        expect(keysLabel('Mod+Shift+KeyZ', true)).toBe('⇧⌘Z');
        expect(keysLabel('Control+Alt+Space', true)).toBe('⌃⌥Space');
        expect(keysLabel('Alt+ArrowUp', true)).toBe('⌥↑');
        expect(keysLabel('Mod+,', true)).toBe('⌘,');
    });

    it('writes words joined by + elsewhere', () => {
        expect(keysLabel('Shift+Enter', false)).toBe('Shift+Enter');
        expect(keysLabel('Mod+Shift+KeyZ', false)).toBe('Ctrl+Shift+Z');
        expect(keysLabel('Super+Digit1', false)).toBe('Win+1');
        expect(keysLabel('Control+PageDown', false)).toBe('Ctrl+Page Down');
    });

    it('reads Esc and Tab as words, and a key it does not know as it is', () => {
        expect(keysLabel('Escape', true)).toBe('Esc');
        expect(keysLabel('Tab', false)).toBe('Tab');
        expect(keysLabel('j', true)).toBe('j');
        expect(keysLabel('Hyper+Backquote', false)).toBe('Hyper+Backquote');
    });
});

describe('withKeys', () => {
    it('puts the keys after the label', () => {
        expect(withKeys('Close', 'Escape', false)).toBe('Close (Esc)');
        expect(withKeys('Previous', 'Shift+Enter', true)).toBe('Previous (⇧↵)');
    });
});
