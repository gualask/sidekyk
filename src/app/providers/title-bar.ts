import { createContext, useContext, useEffect, useState } from 'react';
import type { TitleBarPort } from '@/shared/platform/title-bar';

const TitleBarContext = createContext<TitleBarPort | null>(null);

export const TitleBarProvider = TitleBarContext.Provider;

/** Whether the window's controls sit over the top bar now (see `TitleBarPort`). */
export function useTitleBarOverlaid(): boolean {
    const port = useContext(TitleBarContext);
    if (!port) throw new Error('useTitleBarOverlaid must be used within TitleBarProvider');
    const [overlaid, setOverlaid] = useState(port.overlaid);
    useEffect(() => port.onOverlaidChange(setOverlaid), [port]);
    return overlaid;
}
