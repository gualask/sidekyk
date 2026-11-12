import { IconClock, IconCopyMinus, IconListTree } from '@tabler/icons-react';
import { createPortal } from 'react-dom';
import { useTranslation } from '@/shared/i18n';
import type { PanelProps } from '@/shared/panels/panel';

/** How Files lists the project's files: as a tree, or by their last change (Recent). */
export type FilesView = 'tree' | 'recent';

/**
 * Files' buttons in the panel's header: the other view's icon, as VS Code's "View as Tree" and
 * "View as List"; then, for the tree, VS Code's "Collapse Folders in Explorer": the file shown is
 * revealed again once another is picked.
 */
export function FilesActions({
    header,
    place,
    view,
    onView,
    canCollapse,
    onCollapse,
}: {
    header: HTMLElement;
    place: PanelProps['place'];
    view: FilesView;
    onView: (view: FilesView) => void;
    canCollapse: boolean;
    onCollapse: () => void;
}) {
    const i18n = useTranslation();
    const other = view === 'tree' ? 'files.showRecent' : 'files.showTree';
    return createPortal(
        <>
            {/* in a tile the buttons sit on the right, by the zoom, as Changes' actions do */}
            {place === 'tile' ? <span className="flex-1" /> : null}
            <button
                type="button"
                className="btn-icon h-[26px] w-[26px]"
                title={i18n.t(other)}
                aria-label={i18n.t(other)}
                onClick={() => onView(view === 'tree' ? 'recent' : 'tree')}
            >
                {view === 'tree' ? <IconClock size={14} /> : <IconListTree size={14} />}
            </button>
            {view === 'tree' ? (
                <button
                    type="button"
                    className="btn-icon h-[26px] w-[26px]"
                    title={i18n.t('files.collapse')}
                    aria-label={i18n.t('files.collapse')}
                    disabled={!canCollapse}
                    onClick={onCollapse}
                >
                    <IconCopyMinus size={14} />
                </button>
            ) : null}
        </>,
        header,
    );
}
