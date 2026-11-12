// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@/shared/testing/render-hook';
import type { CardRowsState } from './use-card-rows';
import { useRevealedNote } from './use-revealed-note';

/** The rows' virtualizer: only where it scrolls matters here. */
function rows() {
    const scrollToIndex = vi.fn();
    return {
        scrollToIndex,
        virtualizer: { scrollToIndex } as unknown as CardRowsState['virtualizer'],
    };
}

/** What the cards' panel gives the hook. */
interface Shown {
    reveal: string | null;
    index: number;
    folded?: boolean;
}

describe('useRevealedNote', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('scrolls to the note asked for and lights it up for a moment', () => {
        vi.useFakeTimers();
        const { scrollToIndex, virtualizer } = rows();
        const onRevealed = vi.fn();
        const { result, rerender } = renderHook(
            ({ reveal, index }: Shown) =>
                useRevealedNote({ reveal, index, virtualizer, onRevealed }),
            { props: { reveal: null, index: -1 } },
        );
        expect(result.current).toBeNull();

        rerender({ reveal: 'n2', index: 2 });
        expect(scrollToIndex).toHaveBeenCalledWith(2, { align: 'center' });
        expect(result.current).toBe('n2');
        expect(onRevealed).toHaveBeenCalledTimes(1);

        act(() => vi.advanceTimersByTime(1200));
        expect(result.current).toBeNull();
    });

    it('unfolds a note folded away first, then brings it into view', () => {
        const { scrollToIndex, virtualizer } = rows();
        const onRevealed = vi.fn();
        const unfold = vi.fn();
        const { result, rerender } = renderHook(
            ({ reveal, index, folded }: Shown) =>
                useRevealedNote({ reveal, index, folded, unfold, virtualizer, onRevealed }),
            { props: { reveal: 'done', index: -1, folded: true } },
        );
        expect(unfold).toHaveBeenCalledTimes(1);
        expect(onRevealed).not.toHaveBeenCalled();

        // its group open, the note has a row
        rerender({ reveal: 'done', index: 7, folded: false });
        expect(scrollToIndex).toHaveBeenCalledWith(7, { align: 'center' });
        expect(result.current).toBe('done');
        expect(onRevealed).toHaveBeenCalledTimes(1);
    });

    it('lets go of a note that is not there', () => {
        const { scrollToIndex, virtualizer } = rows();
        const onRevealed = vi.fn();
        const { result } = renderHook(() =>
            useRevealedNote({ reveal: 'gone', index: -1, virtualizer, onRevealed }),
        );
        expect(scrollToIndex).not.toHaveBeenCalled();
        expect(result.current).toBeNull();
        expect(onRevealed).toHaveBeenCalledTimes(1);
    });
});
