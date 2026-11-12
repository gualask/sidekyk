import { IconX, IconZoomIn, IconZoomOut, IconZoomScan } from '@tabler/icons-react';
import { useTranslation } from '@/shared/i18n';
import { withKeys } from '@/shared/platform/keys';
import { shortcutKey } from '@/shared/platform/shortcut';
import { useWindowKeys } from '@/shared/ui/hooks/use-window-keys';
import { isKeyTaken, isOwnKey } from '@/shared/ui/keys';
import { useShownDiagram } from '../../../../application/queries/file-reads';
import { type Placement, ZOOM } from '../../../../model/preview/diagram';
import { ErrorText, Notice } from '../../pane/Pane';
import { useDiagramColors } from '../diagram-colors';
import { DiagramImage, type DrawnDiagram, InvalidLine } from './DiagramImage';
import { useDiagramPlacement } from './use-diagram-placement';

type ShownDiagram = ReturnType<typeof useShownDiagram>;

/**
 * A diagram filling its view: fitted at first and as the view or the diagram changes, until it
 * is zoomed or moved. `⌘+`, `⌘-`, `⌘0` (fit), a pinch or `⌘` and the wheel zoom; a drag or the
 * wheel move it. `onClose`, given over a Markdown preview, is `Esc`'s.
 */
export function DiagramView({ source, onClose }: { source: string; onClose: (() => void) | null }) {
    const shown = useShownDiagram(source, useDiagramColors());
    const diagram = shown.drawn;
    const { view, placement, zoom, fitAgain, drag } = useDiagramPlacement(diagram);
    useZoomKeys(zoom, fitAgain, onClose);

    return (
        <div className="relative h-full overflow-hidden bg-ui-surface-subtle">
            <div
                ref={view}
                className="absolute inset-0 cursor-grab active:cursor-grabbing"
                onPointerDown={drag}
            >
                <ViewContent shown={shown} placement={placement} />
            </div>
            {diagram ? (
                <ZoomBar placement={placement} zoom={zoom} fitAgain={fitAgain} onClose={onClose} />
            ) : null}
            {diagram && shown.invalid ? (
                <div className="absolute right-3 bottom-3 left-3 flex justify-center">
                    <div className="rounded-md bg-ui-surface px-3 py-1.5 shadow-[0_4px_14px_var(--ui-shadow-soft)]">
                        <InvalidLine invalid={shown.invalid} />
                    </div>
                </div>
            ) : null}
        </div>
    );
}

/** `⌘+`, `⌘-`, `⌘0` and, with `onClose`, `Esc`, wherever the focus is but in a field. */
function useZoomKeys(
    zoom: (factor: number) => void,
    fitAgain: () => void,
    onClose: (() => void) | null,
) {
    useWindowKeys(
        (event) => {
            if (event.defaultPrevented || isKeyTaken(event.target)) return;
            if (event.key === 'Escape' && onClose && isOwnKey(event)) {
                event.preventDefault();
                onClose();
                return;
            }
            const key = shortcutKey(event);
            if (key === '=' || key === '+') zoom(ZOOM.step);
            else if (key === '-') zoom(1 / ZOOM.step);
            else if (key === '0') fitAgain();
            else return;
            event.preventDefault();
        },
        { capture: true },
    );
}

/** What the view shows: the diagram where it is placed, else why it does not show. */
function ViewContent({ shown, placement }: { shown: ShownDiagram; placement: Placement | null }) {
    if (shown.error) {
        return (
            <Notice>
                <ErrorText error={shown.error} />
            </Notice>
        );
    }
    if (shown.drawn === null) {
        return shown.invalid ? (
            <Notice>
                <InvalidLine invalid={shown.invalid} />
            </Notice>
        ) : null;
    }
    return placement ? <PlacedImage diagram={shown.drawn} placement={placement} /> : null;
}

function PlacedImage({ diagram, placement }: { diagram: DrawnDiagram; placement: Placement }) {
    return (
        <DiagramImage
            diagram={diagram}
            className="absolute top-0 left-0 max-w-none select-none"
            style={{
                // sized, not scaled: the SVG is drawn again at each size, sharp
                width: diagram.width * placement.scale,
                height: diagram.height * placement.scale,
                transform: `translate(${placement.x}px, ${placement.y}px)`,
            }}
        />
    );
}

/** The zoom's buttons, and with `onClose` the one that closes the view. */
function ZoomBar({
    placement,
    zoom,
    fitAgain,
    onClose,
}: {
    placement: Placement | null;
    zoom: (factor: number) => void;
    fitAgain: () => void;
    onClose: (() => void) | null;
}) {
    const i18n = useTranslation();
    return (
        <div className="absolute top-3 right-3 flex gap-0.5 rounded-lg bg-ui-surface p-0.5 shadow-[0_4px_14px_var(--ui-shadow-soft)]">
            <button
                type="button"
                className="btn-icon h-7 w-7"
                title={withKeys(i18n.t('preview.zoomOut'), 'Mod+-')}
                aria-label={i18n.t('preview.zoomOut')}
                disabled={placement !== null && placement.scale <= ZOOM.min}
                onClick={() => zoom(1 / ZOOM.step)}
            >
                <IconZoomOut size={16} />
            </button>
            <button
                type="button"
                className="btn-icon h-7 w-7"
                title={withKeys(i18n.t('preview.zoomIn'), 'Mod+Equal')}
                aria-label={i18n.t('preview.zoomIn')}
                disabled={placement !== null && placement.scale >= ZOOM.max}
                onClick={() => zoom(ZOOM.step)}
            >
                <IconZoomIn size={16} />
            </button>
            <button
                type="button"
                className="btn-icon h-7 w-7"
                title={withKeys(i18n.t('preview.zoomFit'), 'Mod+Digit0')}
                aria-label={i18n.t('preview.zoomFit')}
                onClick={fitAgain}
            >
                <IconZoomScan size={16} />
            </button>
            {onClose ? (
                <button
                    type="button"
                    className="btn-icon h-7 w-7"
                    title={withKeys(i18n.t('preview.diagramClose'), 'Escape')}
                    aria-label={i18n.t('preview.diagramClose')}
                    onClick={onClose}
                >
                    <IconX size={16} />
                </button>
            ) : null}
        </div>
    );
}
