import { AlertDialog } from '@base-ui/react/alert-dialog';
import { useTranslation } from '@/shared/i18n';

/** Asks before changes are dropped, as `title` and `text` say; keeping on (`keep`) has the focus. */
export function DiscardDialog({
    open,
    title,
    text,
    keep,
    onKeep,
    onDiscard,
}: {
    open: boolean;
    title: string;
    text: string;
    keep: string;
    onKeep: () => void;
    onDiscard: () => void;
}) {
    const { t } = useTranslation();
    return (
        <AlertDialog.Root
            open={open}
            onOpenChange={(next) => {
                if (!next) onKeep();
            }}
        >
            <AlertDialog.Portal>
                <AlertDialog.Backdrop className="dialog-backdrop" />
                <AlertDialog.Popup className="dialog-popup top-[22vh] w-[min(400px,calc(100vw-32px))] p-4">
                    <AlertDialog.Title className="text-[15px] font-bold">{title}</AlertDialog.Title>
                    <AlertDialog.Description className="mt-1.5 text-ui-text-secondary">
                        {text}
                    </AlertDialog.Description>
                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                        <AlertDialog.Close className="btn-ghost-sm">{keep}</AlertDialog.Close>
                        <button
                            type="button"
                            className="btn-ghost-sm text-ui-danger hover:bg-ui-danger-soft hover:text-ui-danger-soft-text"
                            onClick={onDiscard}
                        >
                            {t('notes.discardMarks')}
                        </button>
                    </div>
                </AlertDialog.Popup>
            </AlertDialog.Portal>
        </AlertDialog.Root>
    );
}
