import { IconX, IconZoomIn, IconZoomOut, IconZoomScan } from '@tabler/icons-react';
import {
    type CSSProperties,
    type PointerEvent,
    type ReactNode,
    useEffect,
    useEffectEvent,
    useMemo,
    useRef,
    useState,
} from 'react';
import { errorMessage } from '@/shared/errors/app-error';
import { useTranslation } from '@/shared/i18n';
import { withKeys } from '@/shared/platform/keys';
import { shortcutKey } from '@/shared/platform/shortcut';
import { useWindowKeys } from '@/shared/ui/hooks/use-window-keys';
import { isKeyTaken, isOwnKey } from '@/shared/ui/keys';
import { trackDrag } from '@/shared/ui/pointer-drag';
import { useFileContent, useShownDiagram } from '../application/repository.queries';
import { diagramUrl, fitted, type Placement, ZOOM, zoomedAt } from '../model/diagram';
import type { Diagram } from '../model/repository.types';
import { useDiagramColors } from './diagram-colors';
import { ErrorText, Notice } from './Pane';

type DrawnDiagram = Extract<Diagram, { kind: 'drawn' }>;
type InvalidDiagram = Extract<Diagram, { kind: 'invalid' }>;

/** A drawn diagram as an image, at its own size unless `className` says otherwise. */
function DiagramImage({
    diagram,
    className,
    style,
}: {
    diagram: DrawnDiagram;
    className?: string;
    style?: CSSProperties;
}) {
    const i18n = useTranslation();
    const url = useMemo(() => diagramUrl(diagram.svg), [diagram.svg]);
    return (
        <img
            src={url}
            width={diagram.width}
            height={diagram.height}
            alt={i18n.t('preview.diagram')}
            draggable={false}
            className={className}
            style={style}
        />
    );
}

/** Why a source does not read, in Mermaid's words. */
function InvalidLine({ invalid }: { invalid: InvalidDiagram }) {
    const i18n = useTranslation();
    return (
        <p className="text-xs text-ui-danger">
            {invalid.detail === null
                ? i18n.t('preview.diagramNone')
                : i18n.t('preview.diagramInvalid', { detail: invalid.detail })}
        </p>
    );
}

/**
 * A Markdown file's ` ```mermaid ` block: the diagram in place of its code, at its own size or
 * narrower to fit the text's column, centered; a click opens it over the preview, to zoom. A
 * source that never read shows as code (`code`), with why.
 */
export function DiagramBlock({
    source,
    code,
    onOpen,
}: {
    source: string;
    code: ReactNode;
    onOpen: () => void;
}) {
    const i18n = useTranslation();
    const shown = useShownDiagram(source, useDiagramColors());
    if (shown.error) {
        return (
            <>
                {code}
                <p className="mt-1 text-xs text-ui-danger">{errorMessage(shown.error, i18n)}</p>
            </>
        );
    }
    if (shown.drawn === null) {
        return shown.invalid ? (
            <>
                {code}
                <div className="mt-1">
                    <InvalidLine invalid={shown.invalid} />
                </div>
            </>
        ) : (
            // drawn within milliseconds: room kept, nothing said
            <div className="min-h-24" aria-busy="true" />
        );
    }
    return (
        <figure className="flex flex-col items-center gap-2">
            <button
                type="button"
                className="max-w-full cursor-zoom-in rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent-muted"
                title={i18n.t('preview.diagramOpen')}
                onClick={onOpen}
            >
                <DiagramImage diagram={shown.drawn} className="block h-auto max-w-full" />
            </button>
            {shown.invalid ? <InvalidLine invalid={shown.invalid} /> : null}
        </figure>
    );
}

/**
 * A diagram filling its view: fitted at first and as the view or the diagram changes, until it
 * is zoomed or moved. `⌘+`, `⌘-`, `⌘0` (fit), a pinch or `⌘` and the wheel zoom; a drag or the
 * wheel move it. `onClose`, given over a Markdown preview, is `Esc`'s.
 */
export function DiagramView({ source, onClose }: { source: string; onClose: (() => void) | null }) {
    const i18n = useTranslation();
    const shown = useShownDiagram(source, useDiagramColors());
    const diagram = shown.drawn;
    const view = useRef<HTMLDivElement>(null);
    const [placement, setPlacement] = useState<Placement | null>(null);
    // zoomed or moved by hand: the view no longer fits it by itself
    const [placed, setPlaced] = useState(false);

    // the diagram's size, which a new version of it may change
    const width = diagram?.width ?? null;
    const height = diagram?.height ?? null;
    const fitToView = useEffectEvent(() => {
        const element = view.current;
        if (!element || width === null || height === null) return;
        setPlacement(
            fitted({ width, height }, { width: element.clientWidth, height: element.clientHeight }),
        );
    });
    useEffect(() => {
        const element = view.current;
        if (!element || placed || width === null || height === null) return;
        fitToView();
        const observer = new ResizeObserver(() => fitToView());
        observer.observe(element);
        return () => observer.disconnect();
    }, [placed, width, height]);

    const center = () => ({
        x: (view.current?.clientWidth ?? 0) / 2,
        y: (view.current?.clientHeight ?? 0) / 2,
    });
    const zoom = (factor: number, at = center()) => {
        setPlaced(true);
        setPlacement((current) => current && zoomedAt(current, factor, at));
    };
    const fitAgain = () => {
        setPlaced(false);
        fitToView();
    };
    const zoomByWheel = useEffectEvent((event: WheelEvent) => {
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) {
            const box = view.current?.getBoundingClientRect();
            if (!box) return;
            zoom(Math.exp(-event.deltaY * 0.01), {
                x: event.clientX - box.left,
                y: event.clientY - box.top,
            });
            return;
        }
        setPlaced(true);
        setPlacement(
            (current) =>
                current && { ...current, x: current.x - event.deltaX, y: current.y - event.deltaY },
        );
    });
    useEffect(() => {
        const element = view.current;
        if (!element) return;
        // not passive: a pinch would zoom the whole page otherwise
        const listener = (event: WheelEvent) => zoomByWheel(event);
        element.addEventListener('wheel', listener, { passive: false });
        return () => element.removeEventListener('wheel', listener);
    }, []);

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

    const drag = (event: PointerEvent<HTMLDivElement>) => {
        if (!placement) return;
        const from = { x: event.clientX, y: event.clientY, placement };
        trackDrag(
            event,
            (pointer) => {
                setPlaced(true);
                setPlacement({
                    ...from.placement,
                    x: from.placement.x + pointer.clientX - from.x,
                    y: from.placement.y + pointer.clientY - from.y,
                });
            },
            () => {},
        );
    };

    let content: ReactNode = null;
    if (shown.error) {
        content = (
            <Notice>
                <ErrorText error={shown.error} />
            </Notice>
        );
    } else if (diagram === null) {
        content = shown.invalid ? (
            <Notice>
                <InvalidLine invalid={shown.invalid} />
            </Notice>
        ) : null;
    } else if (placement) {
        content = (
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

    return (
        <div className="relative h-full overflow-hidden bg-ui-surface-subtle">
            <div
                ref={view}
                className="absolute inset-0 cursor-grab active:cursor-grabbing"
                onPointerDown={drag}
            >
                {content}
            </div>
            {diagram ? (
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

/** A `.mmd` file's preview: its diagram filling the panel, drawn again as the file changes. */
export function DiagramPane({ folderId, path }: { folderId: string; path: string }) {
    const i18n = useTranslation();
    const file = useFileContent(folderId, path);
    if (file.isPending) return <Notice>{i18n.t('view.loadingFile')}</Notice>;
    if (file.isError) {
        return (
            <Notice>
                <ErrorText error={file.error} />
            </Notice>
        );
    }
    if (file.data?.kind !== 'text') return <Notice>{i18n.t('preview.none')}</Notice>;
    return <DiagramView source={file.data.text} onClose={null} />;
}
