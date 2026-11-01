import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/shared/i18n';
import { shortcutChangeError, shortcutProblem } from './shortcut-problem';

const en = createTranslator('en', 'en');

const failure = (code: string) => ({ code, message: code });

describe('shortcutChangeError', () => {
    it('names the keys another app holds', () => {
        expect(
            shortcutChangeError('toggle', failure('shortcut_taken'), 'Shift+Super+Space', true, en),
        ).toBe('Another app or the system already uses ⇧⌘Space. Pick another.');
    });

    it('names what the other shortcut does with the keys', () => {
        expect(
            shortcutChangeError(
                'capture',
                failure('shortcut_in_use'),
                'Control+Alt+Space',
                true,
                en,
            ),
        ).toBe('⌃⌥Space already shows and hides Sidekyk. Pick another.');
        expect(
            shortcutChangeError(
                'toggle',
                failure('shortcut_in_use'),
                'Control+Alt+KeyC',
                false,
                en,
            ),
        ).toBe('Ctrl+Alt+C already captures an area of the screen. Pick another.');
    });

    it('reads any other failure as its message', () => {
        expect(
            shortcutChangeError('toggle', failure('invalid_shortcut'), 'Shift+KeyA', true, en),
        ).toBe('That is not a keyboard shortcut Sidekyk can register.');
    });
});

describe('shortcutProblem', () => {
    it('lists a shortcut refused at startup, named by what it does', () => {
        expect(
            shortcutProblem('toggle', { kind: 'refused', keys: 'Control+Alt+Space' }, false, en),
        ).toEqual({
            title: 'The shortcut to show Sidekyk is off',
            detail: 'Another app or the system already uses Ctrl+Alt+Space. Pick another.',
        });
        expect(
            shortcutProblem('capture', { kind: 'refused', keys: 'Control+Alt+KeyC' }, false, en)
                ?.title,
        ).toBe('The shortcut to capture is off');
    });

    it('lists a shortcut whose keys the other took at startup', () => {
        expect(
            shortcutProblem('capture', { kind: 'inUse', keys: 'Control+Alt+KeyC' }, true, en),
        ).toEqual({
            title: 'The shortcut to capture is off',
            detail: '⌃⌥C already shows and hides Sidekyk. Pick another.',
        });
    });

    it('lists a shortcut macOS uses too', () => {
        expect(
            shortcutProblem(
                'toggle',
                { kind: 'active', keys: 'Super+Space', conflict: true },
                true,
                en,
            )?.title,
        ).toBe('The shortcut to show Sidekyk may not work');
    });

    it('lists nothing while the shortcut works, is off, is the desktop’s or is not built', () => {
        expect(
            shortcutProblem(
                'toggle',
                { kind: 'active', keys: 'Super+Space', conflict: false },
                true,
                en,
            ),
        ).toBeNull();
        expect(shortcutProblem('toggle', { kind: 'off' }, true, en)).toBeNull();
        expect(
            shortcutProblem('toggle', { kind: 'command', command: 'sidekyk --toggle' }, false, en),
        ).toBeNull();
        expect(shortcutProblem('capture', null, true, en)).toBeNull();
        expect(shortcutProblem('toggle', undefined, true, en)).toBeNull();
    });
});
