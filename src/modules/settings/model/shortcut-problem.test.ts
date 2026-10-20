import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/shared/i18n';
import { shortcutChangeError, shortcutProblem } from './shortcut-problem';

const en = createTranslator('en', 'en');

const failure = (code: string) => ({ code, message: code });

describe('shortcutChangeError', () => {
    it('names the keys another app holds', () => {
        expect(shortcutChangeError(failure('shortcut_taken'), 'Shift+Super+Space', true, en)).toBe(
            'Another app or the system already uses ⇧⌘Space. Pick another.',
        );
    });

    it('reads any other failure as its message', () => {
        expect(shortcutChangeError(failure('invalid_shortcut'), 'Shift+KeyA', true, en)).toBe(
            'That is not a keyboard shortcut Sidekyk can register.',
        );
    });
});

describe('shortcutProblem', () => {
    it('lists a shortcut refused at startup', () => {
        expect(shortcutProblem({ kind: 'refused', keys: 'Control+Alt+Space' }, false, en)).toEqual({
            title: 'The global shortcut is off',
            detail: 'Another app or the system already uses Ctrl+Alt+Space. Pick another.',
        });
    });

    it('lists a shortcut macOS uses too', () => {
        expect(
            shortcutProblem({ kind: 'active', keys: 'Super+Space', conflict: true }, true, en)
                ?.title,
        ).toBe('The global shortcut may not work');
    });

    it('lists nothing while the shortcut works, is off or is the desktop’s', () => {
        expect(
            shortcutProblem({ kind: 'active', keys: 'Super+Space', conflict: false }, true, en),
        ).toBeNull();
        expect(shortcutProblem({ kind: 'off' }, true, en)).toBeNull();
        expect(
            shortcutProblem({ kind: 'command', command: 'sidekyk --toggle' }, false, en),
        ).toBeNull();
        expect(shortcutProblem(undefined, true, en)).toBeNull();
    });
});
