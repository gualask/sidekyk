import { type ComponentType, type LazyExoticComponent, lazy } from 'react';

/**
 * The project a panel shows: a repository the user added, identified by its root. The same shape
 * as the projects module's `ProjectInfo`, repeated here because `shared` imports no module.
 */
export interface PanelProject {
    root: string;
    name: string;
}

export interface PanelProps {
    project: PanelProject;
}

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
    Component: LazyExoticComponent<ComponentType<PanelProps>>;
    /** Starts loading the chunk ahead of the first show, for the panel the app opens on. */
    preload: () => Promise<unknown>;
    /**
     * What the panel tells about a project on its card at all projects (level 0), if anything.
     * A chunk of its own, loaded with level 0; it fetches only what the card shows.
     */
    summary?: {
        Component: LazyExoticComponent<ComponentType<PanelProps>>;
        preload: () => Promise<unknown>;
    };
}

/** A component of a module's UI, loaded by `load`, a dynamic `import()`. */
interface LazyPart<M> {
    load: () => Promise<M>;
    pick: (module: M) => ComponentType<PanelProps>;
}

function lazyPart<M>({ load, pick }: LazyPart<M>) {
    return {
        Component: lazy(() => load().then((module) => ({ default: pick(module) }))),
        preload: load,
    };
}

/** Builds a panel whose component, and summary if any, are loaded on their first show. */
export function definePanel<M, S = never>({
    load,
    pick,
    summary,
    ...panel
}: Pick<PanelDefinition, 'id' | 'title' | 'icon'> &
    LazyPart<M> & {
        summary?: LazyPart<S>;
    }): PanelDefinition {
    return {
        ...panel,
        ...lazyPart({ load, pick }),
        summary: summary ? lazyPart(summary) : undefined,
    };
}
