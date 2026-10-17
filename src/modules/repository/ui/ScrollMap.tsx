import { type PointerEvent, type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import type { DiffScrollbar } from '@/shared/git/diff-scrollbar';
import { trackDrag } from '@/shared/ui/pointer-drag';
import type { DiffRow } from '../model/diff-rows';
import { changeMarks, type DiffLayout, trackMarks } from './diff-layout';

/** The map's width, narrow or wide (a setting), in pixels. */
const MAP_WIDTH: Record<DiffScrollbar, number> = { narrow: 12, wide: 20 };
/** The least a thumb shows of its track, so it can always be grabbed. */
const MIN_THUMB = 0.04;

type Axis = 'vertical' | 'horizontal';

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
 * Keeps a thumb on its scroll element's position along an axis, with no render: its size is what
 * shows of the content, its place where that is; hidden while everything shows. Follows scrolls,
 * and what changes how far the element scrolls.
 */
function useThumb(scrollElement: HTMLElement, thumb: RefObject<HTMLDivElement | null>, axis: Axis) {
    useEffect(() => {
        const sync = () => {
            const element = thumb.current;
            if (!element) return;
            const [shown, total, at] =
                axis === 'vertical'
                    ? [
                          scrollElement.clientHeight,
                          scrollElement.scrollHeight,
                          scrollElement.scrollTop,
                      ]
                    : [
                          scrollElement.clientWidth,
                          scrollElement.scrollWidth,
                          scrollElement.scrollLeft,
                      ];
            const ratio = total > 0 ? shown / total : 1;
            element.style.display = ratio >= 1 ? 'none' : '';
            const size = Math.max(ratio, MIN_THUMB);
            const place = total > shown ? (at / (total - shown)) * (1 - size) : 0;
            if (axis === 'vertical') {
                element.style.height = `${size * 100}%`;
                element.style.top = `${place * 100}%`;
            } else {
                element.style.width = `${size * 100}%`;
                element.style.left = `${place * 100}%`;
            }
        };
        sync();
        scrollElement.addEventListener('scroll', sync, { passive: true });
        const stop = observeContent(scrollElement, sync);
        return () => {
            scrollElement.removeEventListener('scroll', sync);
            stop();
        };
    }, [scrollElement, thumb, axis]);
}

/** Scrolls the element by a thumb's drag along `axis`: the whole track is the whole content. */
function dragThumb(
    event: PointerEvent<HTMLElement>,
    scrollElement: HTMLElement,
    track: HTMLElement,
    axis: Axis,
) {
    const vertical = axis === 'vertical';
    const from = vertical ? event.clientY : event.clientX;
    const start = vertical ? scrollElement.scrollTop : scrollElement.scrollLeft;
    const scale = vertical
        ? scrollElement.scrollHeight / track.clientHeight
        : scrollElement.scrollWidth / track.clientWidth;
    trackDrag(
        event,
        (pointer) => {
            const moved = ((vertical ? pointer.clientY : pointer.clientX) - from) * scale;
            if (vertical) scrollElement.scrollTop = start + moved;
            else scrollElement.scrollLeft = start + moved;
        },
        () => undefined,
    );
}

/**
 * The viewer's vertical scrollbar, as a map of the changes, as VS Code's: one mark per hunk where
 * its changed lines are (added, deleted, both), in the diff's own soft colors, the hunk gone to
 * outlined, under a translucent thumb. A click on a mark goes to that change, a click elsewhere
 * on the track centers that point, the thumb drags. A click on
 * a mark goes to that change, a click elsewhere on the track centers that point, the thumb drags.
 * Without changes (a file's text) it is the thumb alone.
 */
export function ChangeMap({
    scrollElement,
    layout,
    rows,
    topSpace,
    current,
    width,
    onGoTo,
}: {
    scrollElement: HTMLElement;
    layout: DiffLayout;
    rows: readonly DiffRow[];
    /** Room above the rows (the find bar's), part of what scrolls. */
    topSpace: number;
    /** The hunk gone to, ringed. */
    current: number | null;
    width: DiffScrollbar;
    onGoTo: (hunk: number) => void;
}) {
    const thumb = useRef<HTMLDivElement>(null);
    const track = useRef<HTMLDivElement>(null);
    useThumb(scrollElement, thumb, 'vertical');
    // the track's height: marks closer than a couple of its pixels show as one
    const [height, setHeight] = useState(0);
    useEffect(() => {
        const element = track.current;
        if (!element) return;
        const observer = new ResizeObserver(() => setHeight(element.clientHeight));
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    const changes = useMemo(() => changeMarks(layout, rows), [layout, rows]);
    const marks = useMemo(
        () =>
            trackMarks(
                changes.map((mark) => ({ ...mark, top: mark.top + topSpace })),
                topSpace + layout.total,
                height,
            ),
        [changes, topSpace, layout.total, height],
    );

    return (
        <div
            ref={track}
            className="relative shrink-0 cursor-pointer border-l border-ui-border bg-ui-surface"
            style={{ width: MAP_WIDTH[width] }}
            onPointerDown={(event) => {
                if (event.target !== event.currentTarget || event.button !== 0) return;
                const box = event.currentTarget.getBoundingClientRect();
                const at = (event.clientY - box.top) / box.height;
                scrollElement.scrollTop =
                    at * scrollElement.scrollHeight - scrollElement.clientHeight / 2;
            }}
        >
            {marks.map((mark) => (
                <button
                    key={mark.hunk}
                    type="button"
                    title={
                        mark.count > 1
                            ? `Changes ${mark.hunk + 1}–${mark.hunk + mark.count} of ${layout.hunks.length}`
                            : `Change ${mark.hunk + 1} of ${layout.hunks.length}`
                    }
                    aria-label={`Go to change ${mark.hunk + 1}`}
                    className={`absolute inset-x-0 min-h-[3px] ${
                        current !== null && current >= mark.hunk && current < mark.hunk + mark.count
                            ? 'shadow-[inset_0_0_0_1px_var(--ui-accent)]'
                            : 'hover:shadow-[inset_0_0_0_1px_var(--ui-accent-muted)]'
                    }`}
                    style={{
                        top: mark.top,
                        height: mark.height,
                        background: MARK_COLOR[mark.kind],
                    }}
                    onClick={() => onGoTo(mark.hunk)}
                />
            ))}
            <div
                ref={thumb}
                aria-hidden
                className="absolute inset-x-0 z-[1] cursor-grab bg-ui-text/14 hover:bg-ui-text/26 active:cursor-grabbing active:bg-ui-text/26"
                onPointerDown={(event) => {
                    if (track.current) dragThumb(event, scrollElement, track.current, 'vertical');
                }}
            />
        </div>
    );
}

/** The marks take the colors of the changed lines' gutters: the map is the diff, small. */
const MARK_COLOR = {
    add: 'var(--ui-diff-add-gutter)',
    del: 'var(--ui-diff-del-gutter)',
    mixed: 'linear-gradient(var(--ui-diff-del-gutter) 50%, var(--ui-diff-add-gutter) 50%)',
} as const;

/**
 * The viewer's horizontal scrollbar, under its rows while they run past its right edge: a thumb
 * that drags, a track whose click jumps there. The trackpad and `⇧`+wheel scroll as always.
 */
export function SideScrollbar({ scrollElement }: { scrollElement: HTMLElement }) {
    const [needed, setNeeded] = useState(false);
    useEffect(
        () =>
            observeContent(scrollElement, () =>
                setNeeded(scrollElement.scrollWidth > scrollElement.clientWidth),
            ),
        [scrollElement],
    );
    if (!needed) return null;
    return <SideTrack scrollElement={scrollElement} />;
}

function SideTrack({ scrollElement }: { scrollElement: HTMLElement }) {
    const thumb = useRef<HTMLDivElement>(null);
    const track = useRef<HTMLDivElement>(null);
    useThumb(scrollElement, thumb, 'horizontal');
    return (
        <div
            ref={track}
            aria-hidden
            className="relative h-2.5 shrink-0 border-t border-ui-border bg-ui-surface"
            onPointerDown={(event) => {
                if (event.target !== event.currentTarget || event.button !== 0) return;
                const box = event.currentTarget.getBoundingClientRect();
                const at = (event.clientX - box.left) / box.width;
                scrollElement.scrollLeft =
                    at * scrollElement.scrollWidth - scrollElement.clientWidth / 2;
            }}
        >
            <div
                ref={thumb}
                className="absolute inset-y-0.5 cursor-grab rounded-[3px] bg-ui-text/16 hover:bg-ui-text/26 active:cursor-grabbing active:bg-ui-text/26"
                onPointerDown={(event) => {
                    if (track.current) dragThumb(event, scrollElement, track.current, 'horizontal');
                }}
            />
        </div>
    );
}
