import { useEffect, useEffectEvent } from 'react';
import type { PanelProps, PanelTarget } from '@/shared/panels/panel';
import { type Shown, shownBy } from '../model/targets';

/**
 * Runs `onShown` with each file a panel is asked to show (`fileTarget`), once: then the app is
 * told it was taken, so that mounting again never applies it again.
 */
export function useShownTarget(
    target: PanelTarget | null,
    taken: PanelProps['targetTaken'],
    onShown: (shown: Shown) => void,
) {
    const handle = useEffectEvent(onShown);
    const take = useEffectEvent(taken);
    useEffect(() => {
        if (!target) return;
        const shown = shownBy(target);
        if (shown) handle(shown);
        take(target);
    }, [target]);
}
