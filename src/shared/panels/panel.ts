import type { ComponentType } from 'react';
import type { ProjectInfo } from '@/shared/projects/project-info';
import { preloadable } from '@/shared/ui/preloadable';

export interface PanelProps {
    project: ProjectInfo;
    /**
     * Where the panel shows what is open in it and the actions on it, through a portal: the
     * tile's header, or full screen a header of its own, shown only while the panel puts something
     * in it. Laid out as a row; null until it is mounted.
     */
    header: HTMLElement | null;
}

/** What a panel's summary gets: the project of the card it is on. */
export interface PanelSummaryProps {
    project: ProjectInfo;
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
     * it, so a panel that is not on screen runs none. It is mounted again for another project, so
     * its state (a selection, a scroll position) always belongs to the project it shows.
     */
    Component: ComponentType<PanelProps>;
    /** Starts loading the chunk ahead of the first show, for the panel the app opens on. */
    preload: () => Promise<unknown>;
    /**
     * What the panel tells about a project on its card at all projects (level 0), if anything.
     * A chunk of its own, loaded with level 0; it fetches only what the card shows.
     */
    summary?: {
        Component: ComponentType<PanelSummaryProps>;
        preload: () => Promise<unknown>;
    };
}

/** A component of a module's UI, loaded by `load`, a dynamic `import()`. */
interface LazyPart<M, P> {
    load: () => Promise<M>;
    pick: (module: M) => ComponentType<P>;
}

/** Builds a panel whose component, and summary if any, are loaded on their first show. */
export function definePanel<M, S = never>({
    load,
    pick,
    summary,
    ...panel
}: Pick<PanelDefinition, 'id' | 'title' | 'icon'> &
    LazyPart<M, PanelProps> & {
        summary?: LazyPart<S, PanelSummaryProps>;
    }): PanelDefinition {
    return {
        ...panel,
        ...preloadable(load, pick),
        summary: summary ? preloadable(summary.load, summary.pick) : undefined,
    };
}
