import { Switch } from '@base-ui/react/switch';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useId } from 'react';
import { type Translator, useTranslation } from '@/shared/i18n';
import { MACOS } from '@/shared/platform/macos';
import { CopyIcon } from '@/shared/ui/CopyIcon';
import { copyLabel, useCopyToClipboard } from '@/shared/ui/hooks/use-copy-to-clipboard';
import {
    useGlobalShortcutStatus,
    useSettings,
    useUpdateSettings,
} from '../application/settings.queries';
import type {
    GlobalShortcut,
    GlobalShortcutStatuses,
    ShortcutAction,
} from '../model/settings.types';
import { SHORTCUT_SETTING, shortcutChangeError, shortcutProblem } from '../model/shortcut-problem';
import { ShortcutRecorder } from './ShortcutRecorder';

/** Each shortcut's name in the settings. */
const LABEL = {
    toggle: 'shortcut.toggleLabel',
    capture: 'shortcut.captureLabel',
    note: 'shortcut.noteLabel',
} as const satisfies Record<ShortcutAction, string>;

/**
 * A global shortcut: the one that shows and hides Sidekyk, or, where they are built, the one that
 * captures an area of the screen or the one that opens a quick note. On macOS and Windows: a switch, and under it the field that
 * records a new combination, with what is wrong with it. On Linux the desktop's own shortcut runs
 * a command, which the setting gives to copy. Its changes and their failures are its own.
 */
export function GlobalShortcutSetting({ action }: { action: ShortcutAction }) {
    const settings = useSettings().data;
    const update = useUpdateSettings();
    const statuses = useGlobalShortcutStatus().data;
    const status = statuses?.[action];
    const id = useId();
    const i18n = useTranslation();
    const field = SHORTCUT_SETTING[action];
    const shortcut = settings[field];

    if (!status) return null;
    if (status.kind === 'command') {
        return <DesktopCommand action={action} command={status.command} />;
    }
    if (status.kind === 'unavailable') {
        return <Row id={id} action={action} description={i18n.t('shortcut.unavailable')} />;
    }

    const change = (next: GlobalShortcut) => update.mutate({ ...settings, [field]: next });
    const warning = shortcutWarning(action, update, statuses, i18n);

    return (
        <div className="py-2">
            <div className="flex items-center gap-4">
                <Row id={id} action={action} description={i18n.t('shortcut.description')} />
                <Switch.Root
                    aria-labelledby={id}
                    className="switch"
                    checked={shortcut.enabled}
                    onCheckedChange={(enabled) => change({ ...shortcut, enabled })}
                >
                    <Switch.Thumb className="switch-thumb" />
                </Switch.Root>
            </div>
            {shortcut.enabled ? (
                <div className="mt-2 flex justify-end">
                    <ShortcutRecorder
                        keys={shortcut.keys}
                        labelId={id}
                        onRecord={(keys) => change({ enabled: true, keys })}
                    />
                </div>
            ) : null}
            {warning ? <Warning text={warning} /> : null}
        </div>
    );
}

/**
 * What the setting warns of: why the change that failed failed, otherwise what the shortcut
 * registered has against it.
 */
function shortcutWarning(
    action: ShortcutAction,
    update: ReturnType<typeof useUpdateSettings>,
    statuses: GlobalShortcutStatuses | undefined,
    i18n: Translator,
): string | null {
    if (update.isError && update.variables) {
        const keys = update.variables[SHORTCUT_SETTING[action]].keys;
        return shortcutChangeError(action, update.error, keys, statuses, MACOS, i18n);
    }
    return shortcutProblem(action, statuses, MACOS, i18n)?.detail ?? null;
}

/** A warning under the setting. */
function Warning({ text }: { text: string }) {
    return (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs text-ui-warning-soft-text">
            <IconAlertTriangle size={14} className="mt-px shrink-0 text-ui-warning" />
            <span>{text}</span>
        </p>
    );
}

/** The setting's name and what it does. */
function Row({
    id,
    action,
    description,
}: {
    id: string;
    action: ShortcutAction;
    description: string;
}) {
    const { t } = useTranslation();
    return (
        <div className="min-w-0 flex-1">
            <div id={id} className="font-semibold">
                {t(LABEL[action])}
            </div>
            <div className="mt-0.5 text-xs text-ui-text-muted">{description}</div>
        </div>
    );
}

/** Linux: the command for the desktop's keyboard settings, to copy. */
function DesktopCommand({ action, command }: { action: ShortcutAction; command: string }) {
    const id = useId();
    const { copied, copy } = useCopyToClipboard();
    const i18n = useTranslation();
    return (
        <div className="py-2">
            <Row id={id} action={action} description={i18n.t('shortcut.linux')} />
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
                    {copyLabel(copied, i18n.t('copy.copy'), i18n)}
                </button>
            </div>
        </div>
    );
}
