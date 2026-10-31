import { type ComponentType, lazy } from 'react';

/**
 * A component loaded by a dynamic `import()` on its first show, or ahead of it with `preload`;
 * `Preloaded` shows it.
 */
export interface Preloadable<P> {
    /** Starts loading the chunk ahead of the first show. */
    preload: () => Promise<ComponentType<P>>;
    /** The component once its chunk is loaded, else null. */
    readonly loaded: ComponentType<P> | null;
    /** The same component, suspending until its chunk is loaded: for a show before that. */
    readonly lazy: ComponentType<P>;
}

export function preloadable<M, P extends object>(
    load: () => Promise<M>,
    pick: (module: M) => ComponentType<P>,
): Preloadable<P> {
    let loaded: ComponentType<P> | null = null;
    const preload = () =>
        load().then((module) => {
            loaded = pick(module);
            return loaded;
        });
    return {
        preload,
        get loaded() {
            return loaded;
        },
        lazy: lazy(() => preload().then((component) => ({ default: component }))),
    };
}
