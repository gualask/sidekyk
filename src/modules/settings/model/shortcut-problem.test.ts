import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/shared/i18n';
import type { GlobalShortcutStatus, GlobalShortcutStatuses } from './settings.types';
import { shortcutChangeError, shortcutProblem } from './shortcut-problem';

const en = createTranslator('en', 'en');

const failure = (code: string) => ({ code, message: code });

const active = (keys: string, conflict = false): GlobalShortcutStatus => ({
    kind: 'active',
    keys,
    conflict,
});

/** Each shortcut on its default keys, with some changed. */
function statuses(changed: Partial<GlobalShortcutStatuses> = {}): GlobalShortcutStatuses {
    return {
        toggle: active('Control+Alt+Space'),
        capture: active('Control+Alt+KeyC'),
        note: active('Control+Alt+KeyN'),
        ...changed,
    };
}

describe('shortcutChangeError', () => {
    it('names the keys another app holds', () => {
        expect(
            shortcutChangeError(
                'toggle',
                failure('shortcut_taken'),
                'Shift+Super+Space',
                statuses(),
                true,
                en,
            ),
        ).toBe('Another app or the system already uses ⇧⌘Space. Pick another.');
    });

    it('names what the shortcut holding the keys does', () => {
        expect(
            shortcutChangeError(
                'capture',
                failure('shortcut_in_use'),
                'Control+Alt+Space',
                statuses(),
                true,
                en,
            ),
        ).toBe('⌃⌥Space already shows and hides Sidekyk. Pick another.');
        expect(
            shortcutChangeError(
                'toggle',
                failure('shortcut_in_use'),
                'Control+Alt+KeyC',
                statuses(),
                false,
                en,
            ),
        ).toBe('Ctrl+Alt+C already captures an area of the screen. Pick another.');
        expect(
            shortcutChangeError(
                'capture',
                failure('shortcut_in_use'),
                'Control+Alt+KeyN',
                statuses(),
                true,
                en,
            ),
        ).toBe('⌃⌥N already opens a quick note. Pick another.');
    });

    it('says the keys are another shortcut’s when the statuses do not tell which', () => {
        expect(
            shortcutChangeError(
                'note',
                failure('shortcut_in_use'),
                'Control+Alt+KeyX',
                undefined,
                true,
                en,
            ),
        ).toBe("⌃⌥X is already another of Sidekyk's shortcuts. Pick another.");
    });

    it('reads any other failure as its message', () => {
        expect(
            shortcutChangeError(
                'toggle',
                failure('invalid_shortcut'),
                'Shift+KeyA',
                statuses(),
                true,
                en,
            ),
        ).toBe('That is not a keyboard shortcut Sidekyk can register.');
    });
});

describe('shortcutProblem', () => {
    it('lists a shortcut refused at startup, named by what it does', () => {
        const refused = { kind: 'refused', keys: 'Control+Alt+Space' } as const;
        expect(shortcutProblem('toggle', statuses({ toggle: refused }), false, en)).toEqual({
            title: 'The shortcut to show Sidekyk is off',
            detail: 'Another app or the system already uses Ctrl+Alt+Space. Pick another.',
        });
        expect(
            shortcutProblem(
                'capture',
                statuses({ capture: { kind: 'refused', keys: 'Control+Alt+KeyC' } }),
                false,
                en,
            )?.title,
        ).toBe('The shortcut to capture is off');
        expect(
            shortcutProblem(
                'note',
                statuses({ note: { kind: 'refused', keys: 'Control+Alt+KeyN' } }),
                false,
                en,
            )?.title,
        ).toBe('The shortcut for a quick note is off');
    });

    it('lists a shortcut whose keys another took at startup', () => {
        expect(
            shortcutProblem(
                'note',
                statuses({ note: { kind: 'inUse', keys: 'Control+Alt+KeyC' } }),
                true,
                en,
            ),
        ).toEqual({
            title: 'The shortcut for a quick note is off',
            detail: '⌃⌥C already captures an area of the screen. Pick another.',
        });
    });

    it('lists a shortcut macOS uses too', () => {
        expect(
            shortcutProblem('toggle', statuses({ toggle: active('Super+Space', true) }), true, en)
                ?.title,
        ).toBe('The shortcut to show Sidekyk may not work');
        expect(
            shortcutProblem('note', statuses({ note: active('Super+Space', true) }), true, en)
                ?.title,
        ).toBe('The shortcut for a quick note may not work');
    });

    it('lists nothing while the shortcut works, is off, is the desktop’s or is not built', () => {
        expect(shortcutProblem('toggle', statuses(), true, en)).toBeNull();
        expect(
            shortcutProblem('toggle', statuses({ toggle: { kind: 'off' } }), true, en),
        ).toBeNull();
        expect(
            shortcutProblem(
                'toggle',
                statuses({ toggle: { kind: 'command', command: 'sidekyk --toggle' } }),
                false,
                en,
            ),
        ).toBeNull();
        expect(shortcutProblem('note', statuses({ note: null }), true, en)).toBeNull();
        expect(shortcutProblem('toggle', undefined, true, en)).toBeNull();
    });
});
