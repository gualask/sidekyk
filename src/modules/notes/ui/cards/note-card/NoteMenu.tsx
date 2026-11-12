import { Menu } from '@base-ui/react/menu';
import { IconDots, IconTrash } from '@tabler/icons-react';
import { useTranslation } from '@/shared/i18n';

/** For an open note among others: whether it is on top, and the reorder mode to start. */
export type NoteOrder = { top: boolean; moveToTop: () => void; reorder: () => void };

/**
 * A note's ⋯: move it to the top and reorder (an open note among others), move it to another list
 * or book, delete it.
 */
export function NoteMenu({
    order,
    onMove,
    onDelete,
}: {
    order: NoteOrder | null;
    onMove: () => void;
    onDelete: () => void;
}) {
    const { t } = useTranslation();
    return (
        <Menu.Root>
            <Menu.Trigger
                className="btn-icon h-6 w-6 data-popup-open:bg-ui-surface-hover data-popup-open:text-ui-text"
                title={t('common.more')}
                aria-label={t('notes.moreForNote')}
            >
                <IconDots size={14} />
            </Menu.Trigger>
            <Menu.Portal>
                <Menu.Positioner sideOffset={4} align="end">
                    <Menu.Popup className="menu-popup w-[200px]">
                        {order ? <OrderItems order={order} /> : null}
                        <Menu.Item className="menu-item" onClick={onMove}>
                            {t('notes.move')}
                        </Menu.Item>
                        <Menu.Separator className="mx-1.5 my-1 h-px bg-ui-border" />
                        <Menu.Item className="menu-item danger" onClick={onDelete}>
                            <IconTrash size={14} />
                            {t('notes.delete')}
                        </Menu.Item>
                    </Menu.Popup>
                </Menu.Positioner>
            </Menu.Portal>
        </Menu.Root>
    );
}

/** "Move to top" (unless it is there) and "Reorder", then a separator. */
function OrderItems({ order }: { order: NoteOrder }) {
    const { t } = useTranslation();
    return (
        <>
            {order.top ? null : (
                <Menu.Item className="menu-item" onClick={order.moveToTop}>
                    {t('notes.moveToTop')}
                </Menu.Item>
            )}
            <Menu.Item className="menu-item" onClick={order.reorder}>
                {t('notes.reorder')}
            </Menu.Item>
            <Menu.Separator className="mx-1.5 my-1 h-px bg-ui-border" />
        </>
    );
}
