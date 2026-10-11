import { type ComponentType, type LazyExoticComponent, lazy } from 'react';

/**
 * What a module gives the app to show it as a panel. The app lays panels out and switches between
 * them; a panel knows nothing of the others or of where it sits.
 */
export interface PanelDefinition {
    /** Stable: names the panel in shortcuts, saved layouts and the command palette. */
    id: string;
    title: string;
    icon: ComponentType<{ size?: number; stroke?: number; className?: string }>;
    /**
     * The panel itself, loaded on its first show (one chunk per module). Its queries live inside
     * it, so a panel that is not on screen runs none.
     */
    Component: LazyExoticComponent<ComponentType>;
    /** Starts loading the chunk ahead of the first show, for the panel the app opens on. */
    preload: () => Promise<unknown>;
}

/** Builds a panel whose component comes from `load`, a dynamic `import()` of the module's UI. */
export function definePanel<M>({
    load,
    pick,
    ...panel
}: Pick<PanelDefinition, 'id' | 'title' | 'icon'> & {
    load: () => Promise<M>;
    pick: (module: M) => ComponentType;
}): PanelDefinition {
    return {
        ...panel,
        Component: lazy(() => load().then((module) => ({ default: pick(module) }))),
        preload: load,
    };
}
