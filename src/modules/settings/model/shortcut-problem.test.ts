import { describe, expect, it } from 'vitest';
import { isShortcutError, refusalOf, shortcutProblem } from './shortcut-problem';

const failure = (code: string) => ({ code, message: code });

describe('refusalOf', () => {
    it('reads why the system turned a shortcut down', () => {
        expect(refusalOf(failure('shortcut_taken'))).toBe('taken');
        expect(refusalOf(failure('shortcut_not_allowed'))).toBe('notAllowed');
        expect(refusalOf(failure('invalid_shortcut'))).toBeNull();
    });

    it('counts an invalid shortcut as the shortcut failing', () => {
        expect(isShortcutError(failure('invalid_shortcut'))).toBe(true);
        expect(isShortcutError(failure('shortcut_taken'))).toBe(true);
        expect(isShortcutError(failure('unknown'))).toBe(false);
    });
});

describe('shortcutProblem', () => {
    it('lists a shortcut refused at startup', () => {
        expect(
            shortcutProblem({ kind: 'refused', keys: 'Control+Alt+Space', reason: 'taken' }, false),
        ).toEqual({
            title: 'The global shortcut is off',
            detail: 'Another app or the system already uses Ctrl+Alt+Space. Pick another.',
        });
    });

    it('lists a shortcut macOS uses too', () => {
        expect(
            shortcutProblem({ kind: 'active', keys: 'Super+Space', conflict: true }, true)?.title,
        ).toBe('The global shortcut may not work');
    });

    it('lists nothing while the shortcut works, is off or is the desktop’s', () => {
        expect(
            shortcutProblem({ kind: 'active', keys: 'Super+Space', conflict: false }, true),
        ).toBeNull();
        expect(shortcutProblem({ kind: 'off' }, true)).toBeNull();
        expect(shortcutProblem({ kind: 'command', command: 'sidekyk --toggle' }, false)).toBeNull();
        expect(shortcutProblem(undefined, true)).toBeNull();
    });
});
