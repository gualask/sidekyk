import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef } from 'react';

/**
 * A list of rows of known heights, of which only those on screen render: the element of
 * `scrollRef` scrolls, `VirtualItems` (its own file) lays the rows out inside it. The row at `selectedIndex` is
 * kept in view, since keyboard navigation can move the selection out of it.
 */
export function useVirtualRows<E extends HTMLElement>({
    count,
    size,
    padding,
    selectedIndex = -1,
}: {
    count: number;
    size: (index: number) => number;
    padding: number;
    selectedIndex?: number;
}) {
    const scrollRef = useRef<E>(null);
    const virtualizer = useVirtualizer({
        count,
        getScrollElement: () => scrollRef.current,
        estimateSize: size,
        paddingStart: padding,
        paddingEnd: padding,
        overscan: 10,
    });
    useEffect(() => {
        if (selectedIndex >= 0) virtualizer.scrollToIndex(selectedIndex, { align: 'auto' });
    }, [selectedIndex, virtualizer]);
    return { scrollRef, virtualizer };
}
