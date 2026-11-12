import { Dialog } from '@base-ui/react/dialog';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { IconX } from '@tabler/icons-react';
import { type ReactNode, type RefObject, useId, useRef } from 'react';
import { errorMessage } from '@/shared/errors/app-error';
import type { CodeLines } from '@/shared/git/code-lines';
import type { DiffScrollbar } from '@/shared/git/diff-scrollbar';
import type { DiffView } from '@/shared/git/diff-view';
import type { FileView } from '@/shared/git/file-view';
import { type Locale, type MessageKey, useTranslation } from '@/shared/i18n';
import type { NoteLines } from '@/shared/notes/note-lines';
import { keysLabel, withKeys } from '@/shared/platform/keys';
import { KeyHint } from '@/shared/ui/KeyCaps';
import { useSettings, useUpdateSettings } from '../application/settings.queries';
import type { Theme } from '../model/settings.types';
import { AboutSetting } from './AboutSetting';
import { CopyTemplateSetting } from './CopyTemplateSetting';
import { GlobalShortcutSetting } from './GlobalShortcutSetting';
import { Setting } from './Setting';

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

const FILE_VIEWS: { value: FileView; label: MessageKey }[] = [
    { value: 'preview', label: 'fileView.preview' },
    { value: 'code', label: 'fileView.code' },
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
                            title={withKeys(t('common.close'), 'Escape')}
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
                        <ChoiceSetting
                            label={t('settings.theme.label')}
                            description={t('settings.theme.description')}
                            options={translated(THEMES)}
                            value={settings.theme}
                            current={current}
                            onChange={(theme) => update.mutate({ ...settings, theme })}
                        />
                        <ChoiceSetting
                            label={t('settings.language.label')}
                            description={t('settings.language.description')}
                            options={LANGUAGES}
                            value={i18n.locale}
                            onChange={(language) => update.mutate({ ...settings, language })}
                        />
                    </Section>
                    <Section title={t('settings.diff')}>
                        <ChoiceSetting
                            label={t('settings.diffView.label')}
                            description={t('settings.diffView.description')}
                            options={translated(DIFF_VIEWS)}
                            value={settings.diffView}
                            onChange={(diffView) => update.mutate({ ...settings, diffView })}
                        />
                        <ChoiceSetting
                            label={t('settings.scrollbar.label')}
                            description={t('settings.scrollbar.description')}
                            options={translated(DIFF_SCROLLBARS)}
                            value={settings.diffScrollbar}
                            onChange={(diffScrollbar) =>
                                update.mutate({ ...settings, diffScrollbar })
                            }
                        />
                        <ChoiceSetting
                            label={t('settings.lines.label')}
                            description={t('settings.codeLines.description')}
                            options={translated(CODE_LINES)}
                            value={settings.codeLines}
                            onChange={(codeLines) => update.mutate({ ...settings, codeLines })}
                        />
                        <CopyTemplateSetting />
                    </Section>
                    <Section title={t('panel.files')}>
                        <ChoiceSetting
                            label={t('settings.fileView.label')}
                            description={t('settings.fileView.description')}
                            options={translated(FILE_VIEWS)}
                            value={settings.fileView}
                            onChange={(fileView) => update.mutate({ ...settings, fileView })}
                        />
                    </Section>
                    <Section title={t('panel.notes')}>
                        <ChoiceSetting
                            label={t('settings.lines.label')}
                            description={t('settings.noteLines.description', {
                                key: keysLabel('Alt+KeyZ'),
                            })}
                            options={translated(NOTE_LINES)}
                            value={settings.noteLines}
                            onChange={(noteLines) => update.mutate({ ...settings, noteLines })}
                        />
                    </Section>
                    <Section title={t('common.shortcuts')}>
                        <GlobalShortcutSetting action="toggle" />
                        <GlobalShortcutSetting action="capture" />
                        <GlobalShortcutSetting action="note" />
                    </Section>
                    <Section title={t('settings.about')}>
                        <AboutSetting />
                    </Section>
                    <div className="dialog-foot">
                        <span>{t('settings.applyAtOnce')}</span>
                        <span>
                            <KeyHint text={t('common.escCloses')} keys={{ esc: 'Escape' }} />
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

/**
 * A setting that takes one value among a few, as segments; `current`, if given, gets the one
 * chosen, for the dialog's focus.
 */
function ChoiceSetting<T extends string>({
    label,
    description,
    options,
    value,
    current,
    onChange,
}: {
    label: string;
    description: string;
    options: { value: T; label: string }[];
    value: T;
    current?: RefObject<HTMLElement | null>;
    onChange: (value: T) => void;
}) {
    return (
        <Setting label={label} description={description}>
            {(labelId) => (
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
            )}
        </Setting>
    );
}
