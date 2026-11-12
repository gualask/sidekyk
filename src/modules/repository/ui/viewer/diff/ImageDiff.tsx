import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { type MessageKey, useTranslation } from '@/shared/i18n';
import { useWindowKeys } from '@/shared/ui/hooks/use-window-keys';
import { isKeyTaken, isOwnKey } from '@/shared/ui/keys';
import type { ImageSide, ImageSides } from '../../../model/diff/sides';
import { shortSha } from '../../../model/history/commits';
import type { FileVersion } from '../../../model/repository.types';
import { ImageView } from '../preview/ImageView';

const AREA_NAMES: Record<Exclude<FileVersion['kind'], 'commit'>, MessageKey> = {
    head: 'imageDiff.head',
    index: 'imageDiff.index',
    worktree: 'imageDiff.worktree',
};

/**
 * A changed image, as VS Code shows one: its two sides next to each other, before on the left,
 * each named and with its pixel and file size; one above the other in a narrow panel. An image
 * added or deleted shows its one side. It has no changes to go through, so `n`/`p` go to the next
 * or previous file at once (`onPastEnd`).
 */
export function ImageDiff({
    folderId,
    sides,
    header,
    renderHeader,
    onPastEnd,
}: {
    folderId: string;
    sides: ImageSides;
    /** The panel's header, where the open file goes (see `PanelProps`). */
    header: HTMLElement | null;
    renderHeader: () => ReactNode;
    onPastEnd: (step: 1 | -1) => void;
}) {
    useWindowKeys(
        (event) => {
            if (event.defaultPrevented || isKeyTaken(event.target) || !isOwnKey(event)) return;
            const step = event.key === 'n' ? 1 : event.key === 'p' ? -1 : 0;
            if (step === 0) return;
            event.preventDefault();
            onPastEnd(step);
        },
        { capture: true },
    );
    const shown = (['old', 'new'] as const).flatMap((at) => {
        const side = sides[at];
        return side ? [{ at, side }] : [];
    });

    return (
        <div className="@container h-full">
            {header ? createPortal(renderHeader(), header) : null}
            <div className="flex h-full flex-col @2xl:flex-row">
                {shown.map(({ at, side }) => (
                    <SideView key={at} folderId={folderId} side={side} />
                ))}
            </div>
        </div>
    );
}

/** One side, named by its git area, or a commit's by its short hash. */
function SideView({ folderId, side }: { folderId: string; side: ImageSide }) {
    const i18n = useTranslation();
    const { version } = side;
    const name =
        version.kind === 'commit' ? shortSha(version.sha) : i18n.t(AREA_NAMES[version.kind]);
    return (
        <section className="min-h-0 min-w-0 flex-1">
            <ImageView folderId={folderId} path={side.path} blob={side.blob} name={name} />
        </section>
    );
}
