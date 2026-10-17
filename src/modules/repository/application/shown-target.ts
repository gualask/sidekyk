import { useEffect, useEffectEvent } from 'react';
import type { PanelTarget } from '@/shared/panels/panel';
import { type Shown, shownBy } from '../model/targets';

/** Runs `onShown` with each file a panel is asked to show (`changesTarget`, `fileTarget`). */
export function useShownTarget(target: PanelTarget | null, onShown: (shown: Shown) => void) {
    const handle = useEffectEvent(onShown);
    useEffect(() => {
        const shown = target ? shownBy(target) : null;
        if (shown) handle(shown);
    }, [target]);
}
