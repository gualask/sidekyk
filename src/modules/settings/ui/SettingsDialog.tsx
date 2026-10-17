import { Dialog } from '@base-ui/react/dialog';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { IconX } from '@tabler/icons-react';
import { type ReactNode, type RefObject, useId, useRef } from 'react';
import { errorMessage } from '@/shared/errors/app-error';
import type { DiffView } from '@/shared/git/diff-view';
import type { NoteLines } from '@/shared/notes/note-lines';
import { altLabel } from '@/shared/platform/shortcut';
import { useSettings, useUpdateSettings } from '../application/settings.queries';
import type { Theme } from '../model/settings.types';
import { CopyTemplateSetting } from './CopyTemplateSetting';
import { GlobalShortcutSetting } from './GlobalShortcutSetting';

const THEMES: { value: Theme; label: string }[] = [
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
];

const DIFF_VIEWS: { value: DiffView; label: string }[] = [
    { value: 'changes', label: 'Changes' },
    { value: 'file', label: 'Full file' },
];

const NOTE_LINES: { value: NoteLines; label: string }[] = [
    { value: 'wrap', label: 'Wrap' },
    { value: 'scroll', label: 'Scroll' },
];

/**
 * The settings, in a small modal dialog: changes apply at once, `Esc` or a click outside closes
 * it. It opens on the current choice of the first setting. Loaded with Base UI's dialog after
 * the first paint; it waits for the settings (`Suspense`).
 */
export function SettingsDialog({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const settings = useSettings().data;
    const update = useUpdateSettings();
    const current = useRef<HTMLElement>(null);

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup
                    initialFocus={current}
                    className="dialog-popup top-[12vh] w-[min(520px,calc(100vw-32px))] overflow-auto"
                >
                    <div className="flex items-center gap-2 border-b border-ui-border py-3 pr-3 pl-4">
                        <Dialog.Title className="flex-1 text-[15px] font-bold">
                            Settings
                        </Dialog.Title>
                        <Dialog.Close
                            className="btn-icon h-7 w-7"
                            title="Close (Esc)"
                            aria-label="Close"
                        >
                            <IconX size={16} />
                        </Dialog.Close>
                    </div>
                    {update.isError ? (
                        <p role="alert" className="px-4 pt-3 text-ui-danger">
                            {errorMessage(update.error)}
                        </p>
                    ) : null}
                    <Section title="Appearance">
                        <Setting label="Theme" description="Dark by default.">
                            {(labelId) => (
                                <Choice
                                    labelId={labelId}
                                    options={THEMES}
                                    value={settings.theme}
                                    current={current}
                                    onChange={(theme) => update.mutate({ ...settings, theme })}
                                />
                            )}
                        </Setting>
                    </Section>
                    <Section title="Diff">
                        <Setting
                            label="Open diffs as"
                            description="Only the changed lines, or the whole file with the changes highlighted. The panel's header switches it any time."
                        >
                            {(labelId) => (
                                <Choice
                                    labelId={labelId}
                                    options={DIFF_VIEWS}
                                    value={settings.diffView}
                                    onChange={(diffView) =>
                                        update.mutate({ ...settings, diffView })
                                    }
                                />
                            )}
                        </Setting>
                        <CopyTemplateSetting />
                    </Section>
                    <Section title="Notes">
                        <Setting
                            label="Long lines"
                            description={`Wrap them at the panel's edge, or keep them on one line and scroll sideways. ${altLabel('Z')} switches it from a note.`}
                        >
                            {(labelId) => (
                                <Choice
                                    labelId={labelId}
                                    options={NOTE_LINES}
                                    value={settings.noteLines}
                                    onChange={(noteLines) =>
                                        update.mutate({ ...settings, noteLines })
                                    }
                                />
                            )}
                        </Setting>
                    </Section>
                    <Section title="Shortcuts">
                        <GlobalShortcutSetting />
                    </Section>
                    <div className="dialog-foot">
                        <span>Changes apply at once</span>
                        <span>
                            <kbd className="kbd">Esc</kbd> close
                        </span>
                    </div>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
    const id = useId();
    return (
        <section aria-labelledby={id} className="px-4 pt-1.5 pb-2.5">
            <h3
                id={id}
                className="mt-2.5 mb-1 text-[11px] font-semibold tracking-[.04em] text-ui-text-muted uppercase"
            >
                {title}
            </h3>
            {children}
        </section>
    );
}

/** A setting's row: what it is, and its control, named by the label's id. */
function Setting({
    label,
    description,
    children,
}: {
    label: string;
    description: string;
    children: (labelId: string) => ReactNode;
}) {
    const id = useId();
    return (
        <div className="flex items-center gap-4 py-2">
            <div className="min-w-0 flex-1">
                <div id={id} className="font-semibold">
                    {label}
                </div>
                <div className="mt-0.5 text-xs text-ui-text-muted">{description}</div>
            </div>
            {children(id)}
        </div>
    );
}

/**
 * One value among a few, as segments; `current`, if given, gets the one chosen, for the dialog's
 * focus.
 */
function Choice<T extends string>({
    labelId,
    options,
    value,
    current,
    onChange,
}: {
    labelId: string;
    options: { value: T; label: string }[];
    value: T;
    current?: RefObject<HTMLElement | null>;
    onChange: (value: T) => void;
}) {
    return (
        <RadioGroup
            aria-labelledby={labelId}
            className="seg"
            value={value}
            onValueChange={onChange}
        >
            {options.map((option) => (
                <Radio.Root
                    key={option.value}
                    value={option.value}
                    className="seg-item"
                    ref={option.value === value ? current : undefined}
                >
                    {option.label}
                </Radio.Root>
            ))}
        </RadioGroup>
    );
}
