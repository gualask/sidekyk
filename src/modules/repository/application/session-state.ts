import { useCallback, useState, useSyncExternalStore } from 'react';

/** By key: what the panels show of a project, for the session. */
const values = new Map<string, unknown>();
const listeners = new Map<string, Set<() => void>>();

function subscribeTo(key: string, listener: () => void): () => void {
    let set = listeners.get(key);
    if (!set) {
        set = new Set();
        listeners.set(key, set);
    }
    set.add(listener);
    return () => set.delete(listener);
}

/**
 * State kept for the session, not on disk, under a key naming what it is and the project. Every
 * component on the same key sees the same value as soon as one sets it, as both panels do with the
 * file shown; switching project or zooming mounts a panel again, and it comes back as it was left.
 */
export function useSessionState<T>(key: string, initial: T) {
    // until something is set under the key, its value is what the first mount started with
    const [fallback] = useState(initial);
    const read = (): T => (values.has(key) ? (values.get(key) as T) : fallback);
    const value = useSyncExternalStore(
        useCallback((listener: () => void) => subscribeTo(key, listener), [key]),
        read,
    );
    const set = useCallback(
        (next: T | ((current: T) => T)) => {
            const current = values.has(key) ? (values.get(key) as T) : fallback;
            values.set(key, next instanceof Function ? next(current) : next);
            for (const listener of listeners.get(key) ?? []) listener();
        },
        [key, fallback],
    );
    return [value, set] as const;
}
