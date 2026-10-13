import { type ComponentType, createElement, lazy, useState } from 'react';

/**
 * A component loaded by a dynamic `import()` on its first show, or ahead of it with `preload`.
 * Once loaded it renders at once: `lazy` alone suspends on its first render even when the chunk
 * is already there, which shows an empty frame first (and a zoom transition would capture it).
 */
export function preloadable<M, P extends object>(
    load: () => Promise<M>,
    pick: (module: M) => ComponentType<P>,
) {
    let loaded: ComponentType<P> | null = null;
    const preload = () =>
        load().then((module) => {
            loaded = pick(module);
            return loaded;
        });
    const Lazy = lazy(() => preload().then((component) => ({ default: component })));

    function Preloadable(props: P) {
        // kept for the component's life: going from the lazy one to the loaded one would mount it
        // again
        const [component] = useState<ComponentType<P>>(() => loaded ?? Lazy);
        return createElement(component, props);
    }
    return { Component: Preloadable, preload };
}
