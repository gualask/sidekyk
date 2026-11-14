import { useTranslation } from '@/shared/i18n';

/** The editor's bar: the hint, Cancel and Done. */
export function EditorHeader({
    saving,
    onCancel,
    onDone,
}: {
    saving: boolean;
    onCancel: () => void;
    onDone: () => void;
}) {
    const { t } = useTranslation();
    return (
        <header className="flex items-center gap-2 pb-2 pl-1.5">
            <span className="min-w-0 flex-1 truncate text-xs text-ui-text-muted">
                {t('notes.annotateHint')}
            </span>
            <button type="button" className="btn-ghost-sm" disabled={saving} onClick={onCancel}>
                {t('common.cancel')}
            </button>
            <button type="button" className="btn-primary-sm" disabled={saving} onClick={onDone}>
                {t('notes.annotateDone')}
            </button>
        </header>
    );
}
