import { Dialog } from '@base-ui/react/dialog';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { IconX } from '@tabler/icons-react';
import { type ReactNode, type RefObject, useId, useRef } from 'react';
import { errorMessage } from '@/shared/errors/app-error';
import type { CodeLines } from '@/shared/git/code-lines';
import type { DiffScrollbar } from '@/shared/git/diff-scrollbar';
import type { DiffView } from '@/shared/git/diff-view';
import { type Locale, type MessageKey, RichText, useTranslation } from '@/shared/i18n';
import type { NoteLines } from '@/shared/notes/note-lines';
import { altLabel } from '@/shared/platform/shortcut';
import { useSettings, useUpdateSettings } from '../application/settings.queries';
import type { Theme } from '../model/settings.types';
import { CopyTemplateSetting } from './CopyTemplateSetting';
import { GlobalShortcutSetting } from './GlobalShortcutSetting';

/** Each language by its own name, as anyone looking for theirs reads it. */
const LANGUAGES: { value: Locale; label: string }[] = [
    { value: 'en', label: 'English' },
    { value: 'it', label: 'Italiano' },
];

const THEMES: { value: Theme; label: MessageKey }[] = [
    { value: 'dark', label: 'settings.theme.dark' },
    { value: 'light', label: 'settings.theme.light' },
];

const DIFF_VIEWS: { value: DiffView; label: MessageKey }[] = [
    { value: 'changes', label: 'diffView.changes' },
    { value: 'file', label: 'diffView.file' },
];

const DIFF_SCROLLBARS: { value: DiffScrollbar; label: MessageKey }[] = [
    { value: 'narrow', label: 'settings.scrollbar.narrow' },
    { value: 'wide', label: 'settings.scrollbar.wide' },
];

const CODE_LINES: { value: CodeLines; label: MessageKey }[] = [
    { value: 'scroll', label: 'settings.lines.scroll' },
    { value: 'wrap', label: 'settings.lines.wrap' },
];

const NOTE_LINES: { value: NoteLines; label: MessageKey }[] = [
    { value: 'wrap', label: 'settings.lines.wrap' },
    { value: 'scroll', label: 'settings.lines.scroll' },
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
    const i18n = useTranslation();
    const { t } = i18n;
    const translated = <T extends string>(options: { value: T; label: MessageKey }[]) =>
        options.map((option) => ({ value: option.value, label: t(option.label) }));

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
                            {t('settings.title')}
                        </Dialog.Title>
                        <Dialog.Close
                            className="btn-icon h-7 w-7"
                            title={`${t('common.close')} (Esc)`}
                            aria-label={t('common.close')}
                        >
                            <IconX size={16} />
                        </Dialog.Close>
                    </div>
                    {update.isError ? (
                        <p role="alert" className="px-4 pt-3 text-ui-danger">
                            {errorMessage(update.error, i18n)}
                        </p>
                    ) : null}
                    <Section title={t('settings.appearance')}>
                        <Setting
                            label={t('settings.theme.label')}
                            description={t('settings.theme.description')}
                        >
                            {(labelId) => (
                                <Choice
                                    labelId={labelId}
                                    options={translated(THEMES)}
                                    value={settings.theme}
                                    current={current}
                                    onChange={(theme) => update.mutate({ ...settings, theme })}
                                />
                            )}
                        </Setting>
                        <Setting
                            label={t('settings.language.label')}
                            description={t('settings.language.description')}
                        >
                            {(labelId) => (
                                <Choice
                                    labelId={labelId}
                                    options={LANGUAGES}
                                    value={i18n.locale}
                                    onChange={(language) =>
                                        update.mutate({ ...settings, language })
                                    }
                                />
                            )}
                        </Setting>
                    </Section>
                    <Section title={t('settings.diff')}>
                        <Setting
                            label={t('settings.diffView.label')}
                            description={t('settings.diffView.description')}
                        >
                            {(labelId) => (
                                <Choice
                                    labelId={labelId}
                                    options={translated(DIFF_VIEWS)}
                                    value={settings.diffView}
                                    onChange={(diffView) =>
                                        update.mutate({ ...settings, diffView })
                                    }
                                />
                            )}
                        </Setting>
                        <Setting
                            label={t('settings.scrollbar.label')}
                            description={t('settings.scrollbar.description')}
                        >
                            {(labelId) => (
                                <Choice
                                    labelId={labelId}
                                    options={translated(DIFF_SCROLLBARS)}
                                    value={settings.diffScrollbar}
                                    onChange={(diffScrollbar) =>
                                        update.mutate({ ...settings, diffScrollbar })
                                    }
                                />
                            )}
                        </Setting>
                        <Setting
                            label={t('settings.lines.label')}
                            description={t('settings.codeLines.description')}
                        >
                            {(labelId) => (
                                <Choice
                                    labelId={labelId}
                                    options={translated(CODE_LINES)}
                                    value={settings.codeLines}
                                    onChange={(codeLines) =>
                                        update.mutate({ ...settings, codeLines })
                                    }
                                />
                            )}
                        </Setting>
                        <CopyTemplateSetting />
                    </Section>
                    <Section title={t('panel.notes')}>
                        <Setting
                            label={t('settings.lines.label')}
                            description={t('settings.noteLines.description', {
                                key: altLabel('Z'),
                            })}
                        >
                            {(labelId) => (
                                <Choice
                                    labelId={labelId}
                                    options={translated(NOTE_LINES)}
                                    value={settings.noteLines}
                                    onChange={(noteLines) =>
                                        update.mutate({ ...settings, noteLines })
                                    }
                                />
                            )}
                        </Setting>
                    </Section>
                    <Section title={t('common.shortcuts')}>
                        <GlobalShortcutSetting />
                    </Section>
                    <div className="dialog-foot">
                        <span>{t('settings.applyAtOnce')}</span>
                        <span>
                            <RichText
                                text={t('common.escCloses')}
                                parts={{ esc: <kbd className="kbd">Esc</kbd> }}
                            />
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
