import { type CSSProperties, type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import type { DiffScrollbar } from '@/shared/git/diff-scrollbar';
import type { DiffRow } from '../model/diff-rows';
import { changeMarks, type DiffLayout, trackMarks } from './diff-layout';
import { dragThumb } from './scrollbars';

/** The map's width, narrow or wide (a setting), in pixels; and under the pointer, over the rows. */
const MAP_WIDTH: Record<DiffScrollbar, number> = { narrow: 12, wide: 20 };
const MAP_OPEN_WIDTH: Record<DiffScrollbar, number> = { narrow: 36, wide: 48 };
/**
 * The viewer's vertical scrollbar, as a map of the changes, as VS Code's: one mark per hunk where
 * its changed lines are (added, deleted, both), in the diff's own soft colors, under a translucent
 * thumb. A click on a mark (on at least 12 pixels around it, under the thumb too) goes to that
 * change, a click elsewhere on the track centers that point, the thumb drags. Under the pointer it
 * widens. Without changes (a file's text) it is the thumb alone. Keyboards go through the changes
 * with `n`/`p`: the marks take no tab stop.
 */
export function ChangeMap({
    scrollElement,
    thumb,
    contentHeight,
    layout,
    rows,
    topSpace,
    width,
    onGoTo,
}: {
    scrollElement: HTMLElement;
    thumb: RefObject<HTMLDivElement | null>;
    /** How tall what scrolls is, all of it: the one scale of marks and thumb. */
    contentHeight: number;
    layout: DiffLayout;
    rows: readonly DiffRow[];
    /** Room above the rows (the find bar's), part of what scrolls. */
    topSpace: number;
    width: DiffScrollbar;
    onGoTo: (hunk: number) => void;
}) {
    const track = useRef<HTMLDivElement>(null);
    // the track's height: marks share it, each with room for a click
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
                contentHeight,
                height,
            ),
        [changes, topSpace, contentHeight, height],
    );

    return (
        // keeps its place in the layout; what shows widens over the rows after a moment under the
        // pointer, to aim more easily, and narrows at once when the pointer leaves
        <div className="group/map relative shrink-0" style={{ width: MAP_WIDTH[width] }}>
            <div
                ref={track}
                className="absolute inset-y-0 right-0 z-10 w-full border-l border-ui-border bg-ui-surface transition-[width] duration-150 group-hover/map:w-(--map-open) group-hover/map:delay-200 motion-reduce:transition-none"
                style={{ '--map-open': `${MAP_OPEN_WIDTH[width]}px` } as CSSProperties}
                onPointerDown={(event) => {
                    if (event.target !== event.currentTarget || event.button !== 0) return;
                    const box = event.currentTarget.getBoundingClientRect();
                    const at = (event.clientY - box.top) / box.height;
                    scrollElement.scrollTop =
                        at * scrollElement.scrollHeight - scrollElement.clientHeight / 2;
                }}
            >
                {marks.map((mark) => (
                    // the click's room, around what shows
                    <button
                        key={mark.hunk}
                        type="button"
                        tabIndex={-1}
                        aria-label={`Go to change ${mark.hunk + 1}`}
                        className="absolute inset-x-0"
                        style={{ top: mark.hitTop, height: mark.hitHeight }}
                        onClick={() => onGoTo(mark.hunk)}
                    >
                        <span
                            className="absolute inset-x-0 min-h-[3px]"
                            style={{
                                top: mark.top - mark.hitTop,
                                height: mark.height,
                                background: MARK_COLOR[mark.kind],
                            }}
                        />
                    </button>
                ))}
                <div
                    ref={thumb}
                    aria-hidden
                    className="absolute inset-x-0 z-[1] bg-ui-text/14 hover:bg-ui-text/22 active:bg-ui-text/22"
                    onPointerDown={(event) => {
                        const element = track.current;
                        if (!element) return;
                        // a click that does not drag goes to the change under it, as on the track
                        const at = event.clientY - element.getBoundingClientRect().top;
                        const under = marks.find(
                            (mark) => at >= mark.hitTop && at < mark.hitTop + mark.hitHeight,
                        );
                        dragThumb(event, scrollElement, element, 'vertical', () => {
                            if (under) onGoTo(under.hunk);
                        });
                    }}
                />
            </div>
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
 * The viewer's horizontal scrollbar, under its rows while they run past its right edge (the viewer
 * shows it then): a thumb that drags, a track whose click jumps there. The trackpad and
 * `⇧`+wheel scroll as always.
 */
export function SideScrollbar({
    scrollElement,
    thumb,
}: {
    scrollElement: HTMLElement;
    thumb: RefObject<HTMLDivElement | null>;
}) {
    const track = useRef<HTMLDivElement>(null);
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
                className="absolute inset-y-0.5 rounded-[3px] bg-ui-text/16 hover:bg-ui-text/26 active:bg-ui-text/26"
                onPointerDown={(event) => {
                    if (track.current) dragThumb(event, scrollElement, track.current, 'horizontal');
                }}
            />
        </div>
    );
}
