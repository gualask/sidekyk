import { useEffect, useEffectEvent } from 'react';

/**
 * Listens to the keys pressed anywhere in the window. `capture` comes before the listeners that
 * bubble, such as the workspace's, which skip a key already handled (`preventDefault`).
 */
export function useWindowKeys(onKey: (event: KeyboardEvent) => void, { capture = false } = {}) {
    const handle = useEffectEvent(onKey);
    useEffect(() => {
        const listener = (event: KeyboardEvent) => handle(event);
        window.addEventListener('keydown', listener, { capture });
        return () => window.removeEventListener('keydown', listener, { capture });
    }, [capture]);
}
