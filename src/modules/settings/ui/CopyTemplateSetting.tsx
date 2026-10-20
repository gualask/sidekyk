import { Tooltip } from '@base-ui/react/tooltip';
import { IconAlertTriangle, IconInfoCircle } from '@tabler/icons-react';
import { useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import { DEFAULT_COPY_TEMPLATE, isCopyTemplate } from '@/shared/copy/copy-template';
import { RichText, useTranslation } from '@/shared/i18n';
import { useSettings, useUpdateSettings } from '../application/settings.queries';

/** A pause in typing after which the template is stored. */
const SAVE_AFTER_MS = 400;

/**
 * What a copy from a diff puts on the clipboard, as a template the user writes: stored a moment
 * after typing stops, and when the dialog closes, but only with a placeholder in it. Reset brings
 * back the default.
 */
export function CopyTemplateSetting() {
    const settings = useSettings().data;
    const update = useUpdateSettings();
    const id = useId();
    const errorId = useId();
    const { t } = useTranslation();
    const [draft, setDraft] = useState(settings.copyTemplate);
    const valid = isCopyTemplate(draft);

    const save = useEffectEvent((template: string) => {
        if (isCopyTemplate(template) && template !== settings.copyTemplate) {
            update.mutate({ ...settings, copyTemplate: template });
        }
    });
    // stored once typing pauses
    useEffect(() => {
        const timer = window.setTimeout(() => save(draft), SAVE_AFTER_MS);
        return () => window.clearTimeout(timer);
    }, [draft]);
    // and when the dialog closes before that
    const latest = useRef(draft);
    useEffect(() => {
        latest.current = draft;
    });
    useEffect(() => () => save(latest.current), []);

    return (
        <div className="py-2">
            <div className="flex items-center gap-1.5">
                <label htmlFor={id} className="font-semibold">
                    {t('copyTemplate.label')}
                </label>
                <PlaceholdersHelp />
                <button
                    type="button"
                    className="btn-ghost-sm ml-auto min-h-6 py-0.5"
                    disabled={draft === DEFAULT_COPY_TEMPLATE}
                    onClick={() => setDraft(DEFAULT_COPY_TEMPLATE)}
                >
                    {t('copyTemplate.reset')}
                </button>
            </div>
            <div className="mt-0.5 text-xs text-ui-text-muted">{t('copyTemplate.description')}</div>
            <textarea
                id={id}
                rows={3}
                spellCheck={false}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                aria-invalid={!valid}
                aria-describedby={valid ? undefined : errorId}
                className={`mt-2 block w-full resize-y rounded-lg border bg-ui-surface-subtle px-2.5 py-1.5 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ui-accent-muted ${
                    valid ? 'border-ui-border' : 'border-ui-warning'
                }`}
            />
            {valid ? null : (
                <p
                    id={errorId}
                    role="alert"
                    className="mt-2 flex items-start gap-1.5 text-xs text-ui-warning-soft-text"
                >
                    <IconAlertTriangle size={14} className="mt-px shrink-0 text-ui-warning" />
                    <span>
                        <RichText text={t('copyTemplate.missing')} parts={PLACEHOLDERS} />
                    </span>
                </p>
            )}
        </div>
    );
}

const PLACEHOLDERS = {
    row: <code className="font-mono">{'{row}'}</code>,
    text: <code className="font-mono">{'{text}'}</code>,
};

/** What the placeholders become, with examples, in a tooltip of the app's own. */
function PlaceholdersHelp() {
    const { t } = useTranslation();
    return (
        <Tooltip.Root>
            <Tooltip.Trigger
                delay={150}
                className="btn-icon h-5 w-5 text-ui-text-muted"
                aria-label={t('copyTemplate.help')}
            >
                <IconInfoCircle size={14} />
            </Tooltip.Trigger>
            <Tooltip.Portal>
                <Tooltip.Positioner side="bottom" align="start" sideOffset={6} className="z-30">
                    <Tooltip.Popup className="menu-popup max-w-80 space-y-1.5 px-3 py-2 text-xs leading-relaxed">
                        <p>
                            <RichText
                                text={t('copyTemplate.helpRow')}
                                parts={{
                                    row: <code className="font-mono font-semibold">{'{row}'}</code>,
                                    file: <code className="font-mono">src/cart/total.ts:14</code>,
                                    lines: <code className="font-mono">:12-15</code>,
                                }}
                            />
                        </p>
                        <p>
                            <RichText
                                text={t('copyTemplate.helpText')}
                                parts={{
                                    text: (
                                        <code className="font-mono font-semibold">{'{text}'}</code>
                                    ),
                                }}
                            />
                        </p>
                        <p className="text-ui-text-muted">
                            <RichText
                                text={t('copyTemplate.helpExample')}
                                parts={{
                                    example: (
                                        <code className="font-mono">
                                            {t('copyTemplate.example')}
                                        </code>
                                    ),
                                }}
                            />
                        </p>
                    </Tooltip.Popup>
                </Tooltip.Positioner>
            </Tooltip.Portal>
        </Tooltip.Root>
    );
}
