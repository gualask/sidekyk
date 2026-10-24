import { useEffect, useEffectEvent, useState } from 'react';
import type { CardRowsState } from './use-card-rows';

/** How long a note brought into view stays lit up, as its animation (`.note-flash`). */
const FLASH_MS = 1200;

/**
 * Brings a note asked for (one found in the palette) into view among the cards, and lights it up
 * for a moment: the note lit up, if any. `index` is its row, -1 when it has none; `folded` says
 * it is there but hidden (a done one under its group), and `unfold` shows it first.
 */
export function useRevealedNote({
    reveal,
    index,
    folded = false,
    unfold = () => undefined,
    virtualizer,
    onRevealed,
}: {
    reveal: string | null;
    index: number;
    folded?: boolean;
    unfold?: () => void;
    virtualizer: CardRowsState['virtualizer'];
    onRevealed: () => void;
}): string | null {
    const [flash, setFlash] = useState<string | null>(null);
    const unfolding = useEffectEvent(unfold);
    useEffect(() => {
        if (!reveal) return;
        if (index < 0 && folded) {
            unfolding();
            return;
        }
        if (index >= 0) {
            virtualizer.scrollToIndex(index, { align: 'center' });
            setFlash(reveal);
        }
        onRevealed();
    }, [reveal, index, folded, virtualizer, onRevealed]);
    useEffect(() => {
        if (!flash) return;
        const timer = window.setTimeout(() => setFlash(null), FLASH_MS);
        return () => window.clearTimeout(timer);
    }, [flash]);
    return flash;
}
