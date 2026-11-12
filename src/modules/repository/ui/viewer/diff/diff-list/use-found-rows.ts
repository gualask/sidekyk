import { useEffect, useEffectEvent, useMemo } from 'react';
import type { FindMatch } from '../../../../model/text/find';
import type { LineWrapper } from '../../../../model/text/soft-wrap/wrap';
import { type DiffLayout, lineRowBox, shownWhole } from '../diff-layout';
import type { LineFound } from './DiffRows';

/**
 * The text looked for, row by row (`LineFound` of a row's index), and the match being read
 * brought on screen, centred when it is off screen or under the find bar: the row of a wrapped
 * line it is on. Only when the match changes: a list laid out again (a sidebar dragged) does not
 * scroll back.
 */
export function useFoundRows({
    found,
    scrollElement,
    layout,
    topSpace,
    wrapper,
}: {
    found: { matches: readonly FindMatch[]; current: number } | null;
    scrollElement: HTMLDivElement;
    layout: DiffLayout;
    /** Room above the first row, in pixels, which the find bar covers. */
    topSpace: number;
    wrapper: LineWrapper | null;
}): (index: number) => LineFound | undefined {
    const foundRows = useMemo(() => rangesByRow(found?.matches ?? []), [found?.matches]);
    const currentMatch = found ? found.matches[found.current] : undefined;
    const bringToView = useEffectEvent((match: FindMatch) => {
        // in the list's offsets the screen starts `topSpace` above `scrollTop`, and the bar covers
        // that band
        const { scrollTop, clientHeight } = scrollElement;
        const shown = clientHeight - topSpace;
        const breaks = wrapper?.breaksOf(match.row).breaks ?? [];
        const line = breaks.filter((at) => at <= match.start).length;
        const box = lineRowBox(layout, match.row, line);
        if (shownWhole(box, scrollTop, scrollTop + shown)) return;
        scrollElement.scrollTop = box.top + box.height / 2 - shown / 2;
    });
    useEffect(() => {
        if (currentMatch) bringToView(currentMatch);
    }, [currentMatch]);
    return (index) => {
        const ranges = foundRows.get(index);
        if (!ranges) return undefined;
        const current =
            currentMatch?.row === index
                ? ranges.findIndex(([start]) => start === currentMatch.start)
                : null;
        return { ranges, current };
    };
}

/** The matches' ranges, by the row they are on. */
function rangesByRow(matches: readonly FindMatch[]): Map<number, [number, number][]> {
    const byRow = new Map<number, [number, number][]>();
    for (const { row, start, end } of matches) {
        const ranges = byRow.get(row) ?? [];
        ranges.push([start, end]);
        byRow.set(row, ranges);
    }
    return byRow;
}
