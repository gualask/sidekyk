import { Switch } from '@base-ui/react/switch';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import { errorMessage } from '@/shared/errors/app-error';
import { MACOS } from '@/shared/platform/macos';
import { CopyIcon } from '@/shared/ui/CopyIcon';
import { copyLabel, useCopyToClipboard } from '@/shared/ui/hooks/use-copy-to-clipboard';
import { useGlobalShortcutStatus, useShortcutRecording } from '../application/settings.queries';
import type { GlobalShortcut, Settings } from '../model/settings.types';
import {
    formatShortcut,
    heldModifiers,
    type ShortcutHint,
    shortcutFromEvent,
    shortcutHint,
} from '../model/shortcut-keys';
import { conflictMessage, refusalMessage, refusalOf } from '../model/shortcut-problem';

/**
 * The global shortcut that shows and hides Sidekyk. On macOS and Windows: a switch, and under it
 * the field that records a new combination, with what is wrong with it. On Linux the desktop's
 * own shortcut runs a command, which the setting gives to copy.
 */
export function GlobalShortcutSetting({
    settings,
    update,
    failure,
}: {
    settings: Settings;
    update: (shortcut: GlobalShortcut) => void;
    /** The last change's failure on its shortcut, with the shortcut it tried. */
    failure: { error: unknown; shortcut: GlobalShortcut } | null;
}) {
    const status = useGlobalShortcutStatus().data;
    const id = useId();
    const shortcut = settings.globalShortcut;

    if (!status) return null;
    if (status.kind === 'command') return <ToggleCommand command={status.command} />;
    if (status.kind === 'unavailable') {
        return <Row id={id} description="This system offers Sidekyk no global shortcut." />;
    }

    let warning: string | null = null;
    if (failure) {
        const reason = refusalOf(failure.error);
        warning = reason
            ? refusalMessage(failure.shortcut.keys, reason, MACOS)
            : errorMessage(failure.error);
    } else if (status.kind === 'refused' && shortcut.enabled) {
        warning = refusalMessage(status.keys, status.reason, MACOS);
    } else if (status.kind === 'active' && status.conflict) {
        warning = conflictMessage(status.keys, MACOS);
    }

    return (
        <div className="py-2">
            <div className="flex items-center gap-4">
                <Row id={id} description="Global shortcut, from any app." />
                <Switch.Root
                    aria-labelledby={id}
                    className="switch"
                    checked={shortcut.enabled}
                    onCheckedChange={(enabled) => update({ ...shortcut, enabled })}
                >
                    <Switch.Thumb className="switch-thumb" />
                </Switch.Root>
            </div>
            {shortcut.enabled ? (
                <div className="mt-2 flex justify-end">
                    <ShortcutRecorder
                        keys={shortcut.keys}
                        labelId={id}
                        onRecord={(keys) => update({ enabled: true, keys })}
                    />
                </div>
            ) : null}
            {warning && (shortcut.enabled || failure) ? (
                <p
                    role="alert"
                    className="mt-2 flex items-start gap-1.5 text-xs text-ui-warning-soft-text"
                >
                    <IconAlertTriangle size={14} className="mt-px shrink-0 text-ui-warning" />
                    <span>{warning}</span>
                </p>
            ) : null}
        </div>
    );
}

/** The setting's name and what it does. */
function Row({ id, description }: { id: string; description: string }) {
    return (
        <div className="min-w-0 flex-1">
            <div id={id} className="font-semibold">
                Show and hide Sidekyk
            </div>
            <div className="mt-0.5 text-xs text-ui-text-muted">{description}</div>
        </div>
    );
}

/** What the field says under itself while a combination is typed. */
const HINTS: Record<ShortcutHint | 'start', string> = MACOS
    ? {
          start: 'Hold ⌘, ⌃ or ⌥ and press a key. Shortcuts macOS uses never reach Sidekyk.',
          needsModifier: 'Hold ⌘, ⌃ or ⌥ too: a key alone would be taken from every app.',
          unsupportedKey: 'End with a letter, a digit, F1–F20, Space or an arrow.',
      }
    : {
          start: 'Hold Ctrl, Alt or Win and press a key.',
          needsModifier: 'Hold Ctrl, Alt or Win too: a key alone would be taken from every app.',
          unsupportedKey: 'End with a letter, a digit, F1–F20, Space or an arrow.',
      };

/**
 * The combination, and a new one typed after a click: modifiers and a key, `Esc` to keep the
 * current one. While typed, the field shows the modifiers held and, under it, what is missing.
 * Meanwhile pressing the current shortcut does nothing.
 */
function ShortcutRecorder({
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
    const [recording, setRecording] = useState(false);
    // the modifiers held so far, and what the last key pressed lacked
    const [held, setHeld] = useState('');
    const [hint, setHint] = useState<ShortcutHint | null>(null);
    const setBackendRecording = useShortcutRecording();
    // a combination ending with Space would press the button when Space comes up
    const swallowKeyUp = useRef(false);

    const record = (on: boolean) => {
        setRecording(on);
        setHeld('');
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
        setHeld(heldModifiers(event, MACOS));
        setHint(shortcutHint(event) ?? hint);
    });

    const onKeyUp = useEffectEvent((event: KeyboardEvent) => {
        setHeld(heldModifiers(event, MACOS));
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

    return (
        <div className="flex flex-col items-end gap-1">
            <button
                type="button"
                id={id}
                aria-labelledby={`${labelId} ${id}`}
                aria-describedby={recording ? hintId : undefined}
                title={recording ? undefined : 'Click, then press the new shortcut'}
                className={`flex h-8 min-w-[132px] items-center justify-center rounded-lg border px-3 text-[13px] font-medium tracking-wide outline-none focus-visible:ring-2 focus-visible:ring-ui-accent-muted ${
                    recording
                        ? 'border-ui-accent bg-ui-accent-tint text-ui-text-muted'
                        : 'border-ui-border bg-ui-surface-subtle text-ui-text hover:border-ui-border-hover'
                }`}
                onClick={(event) => {
                    swallowKeyUp.current = false;
                    // WebKit does not focus a button clicked: focused, a click elsewhere stops
                    event.currentTarget.focus();
                    record(!recording);
                }}
                onKeyUp={(event) => {
                    if (!swallowKeyUp.current) return;
                    swallowKeyUp.current = false;
                    event.preventDefault();
                }}
                onBlur={() => {
                    swallowKeyUp.current = false;
                    record(false);
                }}
            >
                {recording ? `${held || 'Press keys'}…` : formatShortcut(keys, MACOS)}
            </button>
            {recording ? (
                <p id={hintId} role="status" className="text-right text-xs text-ui-text-muted">
                    {HINTS[hint ?? 'start']} <kbd className="kbd">Esc</kbd> cancels.
                </p>
            ) : null}
        </div>
    );
}

/** Linux: the command for the desktop's keyboard settings, to copy. */
function ToggleCommand({ command }: { command: string }) {
    const id = useId();
    const { copied, copy } = useCopyToClipboard();
    return (
        <div className="py-2">
            <Row
                id={id}
                description="Add a shortcut in your desktop's keyboard settings that runs:"
            />
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-ui-border bg-ui-surface-subtle py-1 pr-1 pl-3">
                <code className="min-w-0 flex-1 truncate font-mono text-[12.5px]" title={command}>
                    {command}
                </code>
                <button
                    type="button"
                    className="btn-ghost-sm"
                    onClick={() => void copy('command', command)}
                >
                    <CopyIcon copied={copied} />
                    {copyLabel(copied, 'Copy')}
                </button>
            </div>
        </div>
    );
}
