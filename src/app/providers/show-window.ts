import { createContext, useContext, useEffect } from 'react';

const ShowWindowContext = createContext<(() => void) | null>(null);

export const ShowWindowProvider = ShowWindowContext.Provider;

/**
 * Shows the window, created hidden, once `ready`: the effect runs after React committed the
 * frame, so the window never shows a blank page. Later calls change nothing.
 */
export function useShowWindowWhen(ready: boolean) {
    const show = useContext(ShowWindowContext);
    if (!show) throw new Error('useShowWindowWhen must be used within ShowWindowProvider');
    useEffect(() => {
        if (ready) show();
    }, [ready, show]);
}
