import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';

/** The room between cards, and around them, in pixels. */
const GAP = 6;
/** A card's height before it is measured: one line of text and its meta. */
const CARD_ESTIMATE = 64;

/**
 * Note cards in a column that scrolls, measured as they render: only the ones on screen render.
 * `key` names the row at an index, so a card keeps its place as rows come and go.
 */
export function useCardRows(count: number, key: (index: number) => string) {
    const scroller = useRef<HTMLDivElement>(null);
    const virtualizer = useVirtualizer({
        count,
        getScrollElement: () => scroller.current,
        estimateSize: () => CARD_ESTIMATE,
        getItemKey: key,
        gap: GAP,
        paddingStart: GAP,
        paddingEnd: 12,
        overscan: 6,
    });
    return { scroller, virtualizer };
}

export type CardRowsState = ReturnType<typeof useCardRows>;
