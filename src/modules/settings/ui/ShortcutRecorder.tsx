import {
    type KeyboardEvent as ReactKeyboardEvent,
    useEffect,
    useEffectEvent,
    useId,
    useRef,
    useState,
} from 'react';
import { type Translator, useTranslation } from '@/shared/i18n';
import { keysLabel } from '@/shared/platform/keys';
import { MACOS } from '@/shared/platform/macos';
import { KeyHint } from '@/shared/ui/KeyCaps';
import { useShortcutRecording } from '../application/settings.queries';
import {
    neededModifiers,
    pendingShortcut,
    type ShortcutHint,
    shortcutFromEvent,
    shortcutHint,
} from '../model/shortcut-keys';

/**
 * The combination, and a new one typed after a click: modifiers and a key, `Esc` to keep the
 * current one. While typed, the field shows the modifiers held and, under it, what is missing.
 * Meanwhile pressing the current shortcut does nothing.
 */
export function ShortcutRecorder({
    keys,
    labelId,
    onRecord,
}: {
    keys: string;
    labelId: string;
    onRecord: (keys: string) => void;
}) {
    const id = useId();
    const hintId = useId();
    const { recording, pending, hint, toggle, keyUp, stop } = useRecording(keys, onRecord);
    const i18n = useTranslation();

    return (
        <div className="flex flex-col items-end gap-1">
            <button
                type="button"
                id={id}
                aria-labelledby={`${labelId} ${id}`}
                aria-describedby={recording ? hintId : undefined}
                title={recording ? undefined : i18n.t('shortcut.recordTitle')}
                className={`flex h-8 min-w-[132px] items-center justify-center rounded-lg border px-3 text-[13px] font-medium tracking-wide outline-none focus-visible:ring-2 focus-visible:ring-ui-accent-muted ${
                    recording
                        ? 'border-ui-accent bg-ui-accent-tint text-ui-text-muted'
                        : 'border-ui-border bg-ui-surface-subtle text-ui-text hover:border-ui-border-hover'
                }`}
                onClick={(event) => toggle(event.currentTarget)}
                onKeyUp={keyUp}
                onBlur={stop}
            >
                {recording ? (pending ?? i18n.t('shortcut.pressKeys')) : keysLabel(keys)}
            </button>
            {recording ? (
                <p id={hintId} role="status" className="text-right text-xs text-ui-text-muted">
                    {hintText(hint, i18n)}{' '}
                    <KeyHint text={i18n.t('shortcut.escCancels')} keys={{ esc: 'Escape' }} />
                </p>
            ) : null}
        </div>
    );
}

/**
 * A combination being typed in the field: whether it is, the modifiers held so far and what the
 * last key pressed lacked. While on, keys are read from the whole window before anything else
 * and the backend leaves the current shortcut alone; a combination is recorded with its key.
 */
function useRecording(keys: string, onRecord: (keys: string) => void) {
    const [recording, setRecording] = useState(false);
    const [pending, setPending] = useState<string | null>(null);
    const [hint, setHint] = useState<ShortcutHint | null>(null);
    const setBackendRecording = useShortcutRecording();
    // a combination ending with Space would press the button when Space comes up
    const swallowKeyUp = useRef(false);

    const record = (on: boolean) => {
        setRecording(on);
        setPending(null);
        setHint(null);
    };

    const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
        // Tab alone leaves the field, and stops recording
        if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) {
            record(false);
            return;
        }
        // every other key is the field's: not the dialog's `Esc`, not the workspace's keys
        event.preventDefault();
        event.stopPropagation();
        swallowKeyUp.current = true;
        if (event.key === 'Escape') {
            record(false);
            return;
        }
        const next = shortcutFromEvent(event);
        if (next) {
            record(false);
            if (next !== keys) onRecord(next);
            return;
        }
        setPending(pendingShortcut(event, MACOS));
        setHint(shortcutHint(event) ?? hint);
    });

    const onKeyUp = useEffectEvent((event: KeyboardEvent) => {
        setPending(pendingShortcut(event, MACOS));
    });

    // While recording, keys are read from the whole window before anything else: WebKit gives
    // no focus to a button clicked, so the field may not be where the keys go.
    useEffect(() => {
        if (!recording) return;
        setBackendRecording(true);
        const down = (event: KeyboardEvent) => onKeyDown(event);
        const up = (event: KeyboardEvent) => onKeyUp(event);
        window.addEventListener('keydown', down, true);
        window.addEventListener('keyup', up, true);
        return () => {
            setBackendRecording(false);
            window.removeEventListener('keydown', down, true);
            window.removeEventListener('keyup', up, true);
        };
    }, [recording, setBackendRecording]);

    /** The field clicked: recording starts, or stops. */
    const toggle = (field: HTMLElement) => {
        swallowKeyUp.current = false;
        // WebKit does not focus a button clicked: focused, a click elsewhere stops
        field.focus();
        record(!recording);
    };
    /** A key up on the field: swallowed when it ended a combination. */
    const keyUp = (event: ReactKeyboardEvent) => {
        if (!swallowKeyUp.current) return;
        swallowKeyUp.current = false;
        event.preventDefault();
    };
    /** The field left: recording stops. */
    const stop = () => {
        swallowKeyUp.current = false;
        record(false);
    };
    return { recording, pending, hint, toggle, keyUp, stop };
}

/** What the field says under itself while a combination is typed. */
function hintText(hint: ShortcutHint | null, i18n: Translator): string {
    const needed = neededModifiers(MACOS, i18n);
    if (hint === 'needsModifier') return i18n.t('shortcut.hint.needsModifier', { needed });
    if (hint === 'unsupportedKey') return i18n.t('shortcut.hint.unsupportedKey');
    const start = i18n.t('shortcut.hint.start', { needed });
    return MACOS ? `${start} ${i18n.t('shortcut.hint.macos')}` : start;
}
