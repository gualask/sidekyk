import type { Virtualizer } from '@tanstack/react-virtual';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { DiffRow } from '../../../../model/diff/diff-rows';
import { type DiffLayout, heightOf, rowAt } from '../diff-layout';

/**
 * Keeps the rows on screen where they are. Laid out again (the list's width, long lines switched,
 * the file read again), the virtualizer takes their new heights, and the same rows keep the one
 * at the top where it is, as an editor keeps the line it shows as it wraps again. Where the screen
 * was is taken as it last scrolled: once the new heights are in, a shorter list has already
 * pulled `scrollTop` back. The room above (`topSpace`) comes and goes without moving them either,
 * but at the top, where it shows.
 */
export function useScrollKept({
    scrollElement,
    layout,
    rows,
    topSpace,
    virtualizer,
}: {
    scrollElement: HTMLDivElement;
    layout: DiffLayout;
    rows: readonly DiffRow[];
    topSpace: number;
    virtualizer: Virtualizer<HTMLDivElement, Element>;
}) {
    const scrolledTo = useRef(scrollElement.scrollTop);
    useEffect(() => {
        const keep = () => {
            scrolledTo.current = scrollElement.scrollTop;
        };
        scrollElement.addEventListener('scroll', keep, { passive: true });
        return () => scrollElement.removeEventListener('scroll', keep);
    }, [scrollElement]);
    const laidOut = useRef({ layout, rows });
    useLayoutEffect(() => {
        const before = laidOut.current;
        if (before.layout === layout) return;
        laidOut.current = { layout, rows };
        virtualizer.measure();
        const offset = scrolledTo.current - topSpace;
        if (before.rows !== rows || offset <= 0) return;
        scrollElement.scrollTop = keptOffset(before.layout, layout, offset) + topSpace;
        scrolledTo.current = scrollElement.scrollTop;
    }, [layout, rows, virtualizer, scrollElement, topSpace]);

    const shownSpace = useRef(topSpace);
    useLayoutEffect(() => {
        const change = topSpace - shownSpace.current;
        shownSpace.current = topSpace;
        if (change !== 0 && scrollElement.scrollTop > 0) scrollElement.scrollTop += change;
    }, [topSpace, scrollElement]);
}

/**
 * Where the screen goes in the rows laid out `after`, to keep the row at `offset` in `before`
 * where it was: as far into it, within its new height.
 */
function keptOffset(before: DiffLayout, after: DiffLayout, offset: number): number {
    const row = rowAt(before, offset);
    const into = offset - (before.starts[row] ?? 0);
    return (after.starts[row] ?? 0) + Math.min(into, heightOf(after, row) - 1);
}
