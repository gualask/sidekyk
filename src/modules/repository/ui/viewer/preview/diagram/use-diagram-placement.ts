import {
    type PointerEvent,
    type RefObject,
    useEffect,
    useEffectEvent,
    useRef,
    useState,
} from 'react';
import { trackDrag } from '@/shared/ui/pointer-drag';
import { fitted, type Placement, zoomedAt } from '../../../../model/preview/diagram';

/**
 * Where a diagram of `size` sits in its view (`view`): fitted at first and as the view or the
 * diagram changes, until it is zoomed or moved by hand. A pinch or `⌘` and the wheel zoom it at
 * the pointer; a drag or the wheel move it.
 */
export function useDiagramPlacement(size: { width: number; height: number } | null) {
    const view = useRef<HTMLDivElement>(null);
    const [placement, setPlacement] = useState<Placement | null>(null);
    // zoomed or moved by hand: the view no longer fits it by itself
    const [placed, setPlaced] = useState(false);

    // the diagram's size, which a new version of it may change
    const width = size?.width ?? null;
    const height = size?.height ?? null;
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

    const zoom = (factor: number, at = viewCenter(view.current)) => {
        setPlaced(true);
        setPlacement((current) => current && zoomedAt(current, factor, at));
    };
    const fitAgain = () => {
        setPlaced(false);
        fitToView();
    };
    useWheel(view, (event) => {
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

    return { view, placement, zoom, fitAgain, drag };
}

/** The middle of the view, where a zoom from the keys or the buttons centers. */
function viewCenter(element: HTMLElement | null): { x: number; y: number } {
    return { x: (element?.clientWidth ?? 0) / 2, y: (element?.clientHeight ?? 0) / 2 };
}

/** Listens to the wheel over `view`, not passive: a pinch would zoom the whole page otherwise. */
function useWheel(view: RefObject<HTMLElement | null>, onWheel: (event: WheelEvent) => void) {
    const handle = useEffectEvent(onWheel);
    useEffect(() => {
        const element = view.current;
        if (!element) return;
        const listener = (event: WheelEvent) => handle(event);
        element.addEventListener('wheel', listener, { passive: false });
        return () => element.removeEventListener('wheel', listener);
    }, [view]);
}
