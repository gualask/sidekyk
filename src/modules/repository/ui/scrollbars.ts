import { type PointerEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { trackDrag } from '@/shared/ui/pointer-drag';

/** The least a thumb shows of its track, so it can always be grabbed. */
const MIN_THUMB = 0.04;

export type Axis = 'vertical' | 'horizontal';

/** Along an axis: what shows of the content, all of it, and how far it is scrolled. */
function extent(element: HTMLElement, axis: Axis): [shown: number, total: number, at: number] {
    return axis === 'vertical'
        ? [element.clientHeight, element.scrollHeight, element.scrollTop]
        : [element.clientWidth, element.scrollWidth, element.scrollLeft];
}

/** A thumb's share of its track: what shows of the content, at least `MIN_THUMB`. */
function thumbSize(shown: number, total: number): number {
    return Math.max(total > 0 ? shown / total : 1, MIN_THUMB);
}

/** Puts a thumb where its scroll element is along an axis; hidden while everything shows. */
function placeThumb(thumb: HTMLElement | null, scrollElement: HTMLElement, axis: Axis) {
    if (!thumb) return;
    const [shown, total, at] = extent(scrollElement, axis);
    thumb.style.display = total <= shown ? 'none' : '';
    const size = thumbSize(shown, total);
    const place = total > shown ? (at / (total - shown)) * (1 - size) : 0;
    if (axis === 'vertical') {
        thumb.style.height = `${size * 100}%`;
        thumb.style.top = `${place * 100}%`;
    } else {
        thumb.style.width = `${size * 100}%`;
        thumb.style.left = `${place * 100}%`;
    }
}

/**
 * Calls `onChange` whenever the element or what it holds changes size, or what it holds changes:
 * how far it scrolls may have.
 */
function observeContent(element: HTMLElement, onChange: () => void): () => void {
    const resizes = new ResizeObserver(onChange);
    const observeAll = () => {
        resizes.disconnect();
        resizes.observe(element);
        for (const child of element.children) resizes.observe(child);
    };
    const children = new MutationObserver(() => {
        observeAll();
        onChange();
    });
    observeAll();
    children.observe(element, { childList: true });
    return () => {
        resizes.disconnect();
        children.disconnect();
    };
}

/**
 * A viewer's own scrollbars, kept by one observer of its scroll element: their thumbs follow every
 * scroll with no render; what they need to draw (how tall the content is, whether its lines run
 * past the edge) renders only when it changes.
 */
export function useScrollbars(scrollElement: HTMLElement | null) {
    const vertical = useRef<HTMLDivElement>(null);
    const horizontal = useRef<HTMLDivElement>(null);
    const [content, setContent] = useState({ height: 0, wide: false });
    useEffect(() => {
        if (!scrollElement) return;
        const thumbs = () => {
            placeThumb(vertical.current, scrollElement, 'vertical');
            placeThumb(horizontal.current, scrollElement, 'horizontal');
        };
        const measure = () => {
            thumbs();
            const height = scrollElement.scrollHeight;
            const wide = scrollElement.scrollWidth > scrollElement.clientWidth;
            setContent((current) =>
                current.height === height && current.wide === wide ? current : { height, wide },
            );
        };
        measure();
        scrollElement.addEventListener('scroll', thumbs, { passive: true });
        const stop = observeContent(scrollElement, measure);
        return () => {
            scrollElement.removeEventListener('scroll', thumbs);
            stop();
        };
    }, [scrollElement]);
    // the horizontal bar shows once the lines run past the edge: its thumb is placed as it does
    useLayoutEffect(() => {
        if (content.wide && scrollElement) {
            placeThumb(horizontal.current, scrollElement, 'horizontal');
        }
    }, [content.wide, scrollElement]);
    return { vertical, horizontal, height: content.height, wide: content.wide };
}

/**
 * Scrolls the element by a thumb's drag along `axis`, the thumb under the pointer: its travel on
 * the track is the content's. `onClick` follows a press that did not move.
 */
export function dragThumb(
    event: PointerEvent<HTMLElement>,
    scrollElement: HTMLElement,
    track: HTMLElement,
    axis: Axis,
    onClick: () => void = () => undefined,
) {
    const vertical = axis === 'vertical';
    const from = vertical ? event.clientY : event.clientX;
    const [shown, total, start] = extent(scrollElement, axis);
    const trackSize = vertical ? track.clientHeight : track.clientWidth;
    const travel = (1 - thumbSize(shown, total)) * trackSize;
    const scale = travel > 0 ? (total - shown) / travel : 0;
    trackDrag(
        event,
        (pointer) => {
            const moved = ((vertical ? pointer.clientY : pointer.clientX) - from) * scale;
            if (vertical) scrollElement.scrollTop = start + moved;
            else scrollElement.scrollLeft = start + moved;
        },
        (moved) => {
            if (!moved) onClick();
        },
    );
}
