import { describe, expect, it } from 'vitest';
import { formatShortcut, heldModifiers, shortcutFromEvent, shortcutHint } from './shortcut-keys';

const press = (
    code: string,
    held: Partial<Record<'ctrl' | 'alt' | 'shift' | 'meta', boolean>>,
) => ({
    code,
    ctrlKey: held.ctrl ?? false,
    altKey: held.alt ?? false,
    shiftKey: held.shift ?? false,
    metaKey: held.meta ?? false,
});

describe('shortcutFromEvent', () => {
    it('lists the modifiers in a fixed order, then the key', () => {
        expect(shortcutFromEvent(press('Space', { meta: true, ctrl: true, alt: true }))).toBe(
            'Control+Alt+Super+Space',
        );
        expect(shortcutFromEvent(press('KeyK', { shift: true, meta: true }))).toBe(
            'Shift+Super+KeyK',
        );
        expect(shortcutFromEvent(press('F5', { alt: true }))).toBe('Alt+F5');
    });

    it('waits while only modifiers are held', () => {
        expect(shortcutFromEvent(press('AltLeft', { alt: true }))).toBeNull();
        expect(shortcutFromEvent(press('MetaRight', { meta: true }))).toBeNull();
    });

    it('needs Ctrl, Alt or the command key', () => {
        expect(shortcutFromEvent(press('KeyA', {}))).toBeNull();
        expect(shortcutFromEvent(press('KeyA', { shift: true }))).toBeNull();
    });

    it('leaves out keys whose character depends on the layout', () => {
        expect(shortcutFromEvent(press('Backquote', { ctrl: true }))).toBeNull();
        expect(shortcutFromEvent(press('Escape', { ctrl: true }))).toBeNull();
        expect(shortcutFromEvent(press('F21', { ctrl: true }))).toBeNull();
    });
});

describe('formatShortcut', () => {
    it('writes macOS symbols together', () => {
        expect(formatShortcut('Control+Alt+Space', true)).toBe('⌃⌥Space');
        expect(formatShortcut('Shift+Super+KeyK', true)).toBe('⇧⌘K');
        expect(formatShortcut('Super+ArrowUp', true)).toBe('⌘↑');
    });

    it('writes names joined by + elsewhere', () => {
        expect(formatShortcut('Control+Alt+Space', false)).toBe('Ctrl+Alt+Space');
        expect(formatShortcut('Super+Digit1', false)).toBe('Win+1');
        expect(formatShortcut('Control+PageDown', false)).toBe('Ctrl+Page Down');
    });

    it('keeps a part it does not know as it is', () => {
        expect(formatShortcut('Hyper+Backquote', false)).toBe('Hyper+Backquote');
    });
});

describe('shortcutHint', () => {
    it('asks for a modifier when a key comes alone', () => {
        expect(shortcutHint(press('KeyA', {}))).toBe('needsModifier');
        expect(shortcutHint(press('KeyA', { shift: true }))).toBe('needsModifier');
    });

    it('names a key a shortcut may not end with', () => {
        expect(shortcutHint(press('Backquote', { ctrl: true }))).toBe('unsupportedKey');
    });

    it('says nothing while modifiers are held, or once the shortcut is whole', () => {
        expect(shortcutHint(press('ControlLeft', { ctrl: true }))).toBeNull();
        expect(shortcutHint(press('KeyK', { ctrl: true }))).toBeNull();
    });
});

describe('heldModifiers', () => {
    it('writes the modifiers held before the key', () => {
        expect(heldModifiers(press('AltLeft', { ctrl: true, alt: true }), true)).toBe('⌃⌥');
        expect(heldModifiers(press('AltLeft', { ctrl: true, alt: true }), false)).toBe('Ctrl+Alt+');
        expect(heldModifiers(press('KeyA', {}), true)).toBe('');
    });
});
