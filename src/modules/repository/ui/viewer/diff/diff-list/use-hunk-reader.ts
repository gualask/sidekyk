import { type RefObject, useEffect } from 'react';
import type { DiffRow } from '../../../../model/diff/diff-rows';
import {
    type DiffLayout,
    hunkFrom,
    hunkStepped,
    offsetBelow,
    openingOffset,
    rowAt,
    spanBox,
} from '../diff-layout';

/** What the viewer reads: the hunk being read, and a step to the next or previous one. */
export interface HunkReader {
    current: () => number;
    /** Goes to the next (1) or previous (-1) hunk; false when there is none that way. */
    step: (step: 1 | -1) => boolean;
    /** Goes to a hunk, as its mark on the map does. */
    goTo: (hunk: number) => void;
}

/**
 * Puts the list's `HunkReader` in `reader` while it shows: the hunk being read is `linesAbove`
 * lines below the top, or the one gone to (`current`: `n`/`p`, the map, the one opened on) while
 * it is on screen. That one is where the next step starts from, even when the list cannot scroll
 * to it (a short diff).
 */
export function useHunkReader({
    reader,
    scrollElement,
    layout,
    rows,
    linesAbove,
    topSpace,
    current,
    onCurrent,
}: {
    reader: RefObject<HunkReader | null>;
    scrollElement: HTMLDivElement;
    layout: DiffLayout;
    rows: readonly DiffRow[];
    linesAbove: number;
    /** Room above the first row, in pixels. */
    topSpace: number;
    current: number | null;
    onCurrent: (hunk: number) => void;
}) {
    useEffect(() => {
        // the line being read: `linesAbove` lines below the top, as a hunk opens
        const reading = () =>
            offsetBelow(layout, Math.max(0, scrollElement.scrollTop - topSpace), linesAbove);
        const goTo = (hunk: number) => {
            onCurrent(hunk);
            scrollElement.scrollTop = openingOffset(layout, hunk, linesAbove) + topSpace;
        };
        // the hunk gone to, while on screen: scrolled away from it, the line read counts
        const shown = () =>
            hunkOnScreen(
                layout,
                current,
                scrollElement.scrollTop - topSpace,
                scrollElement.clientHeight,
            );
        const stepped = (step: 1 | -1): number | null => {
            const from = shown();
            if (from === null) return hunkStepped(layout, reading(), step);
            return layout.hunks[from + step] ? from + step : null;
        };
        reader.current = {
            current: () => shown() ?? hunkFrom(layout, rows, rowAt(layout, reading())),
            step: (step) => {
                const hunk = stepped(step);
                if (hunk === null) return false;
                goTo(hunk);
                return true;
            },
            goTo,
        };
        return () => {
            reader.current = null;
        };
    }, [reader, scrollElement, layout, rows, linesAbove, topSpace, current, onCurrent]);
}

/** Hunk `hunk`, if any of it is on the screen `screen` pixels down the rows, `height` tall. */
function hunkOnScreen(
    layout: DiffLayout,
    hunk: number | null,
    screen: number,
    height: number,
): number | null {
    const span = hunk === null ? undefined : layout.hunks[hunk];
    if (!span) return null;
    const { top, height: spanHeight } = spanBox(layout, span);
    return top < screen + height && top + spanHeight > screen ? hunk : null;
}
