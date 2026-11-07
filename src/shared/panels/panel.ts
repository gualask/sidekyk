import type { ComponentType } from 'react';
import type { MessageKey } from '@/shared/i18n';
import type { ProjectFolder, ProjectInfo } from '@/shared/projects/project-info';
import { type Preloadable, preloadable } from '@/shared/ui/preloadable';

/**
 * Something the app asks a panel to show, such as a file picked in the command palette. Each
 * request is a new object, so asking twice for the same thing shows it twice.
 */
export interface PanelTarget {
    /** What to show, in the panel's own terms (the panel's module builds it). */
    key: string;
}

/** Where a panel is: a tile among a project's panels (level 1), or full screen (level 2). */
type PanelPlace = 'tile' | 'full';

export interface PanelProps {
    project: ProjectInfo;
    /** The project's folder on screen, which its panels of files read; null without folder. */
    folder: ProjectFolder | null;
    /**
     * Where the panel shows what is open in it and the actions on it, through a portal: the
     * tile's header, or full screen a header of its own, shown only while the panel puts something
     * in it. Laid out as a row; null until it is mounted.
     */
    header: HTMLElement | null;
    /**
     * In a tile whose width the app sets: tells it how wide the tile must be to show all the panel
     * has (a function measuring it, null to stop), for its splitter's double click. Null in any
     * other place.
     */
    tileFit: ((measure: (() => number) | null) => void) | null;
    /**
     * What to show, when the app asks for something; null leaves the panel as the user left it.
     * A request, not state: the panel writes what it asks into its own state, does its effects
     * once, then says it took it (`targetTaken`), and the app forgets it
     * (`docs/architecture.md`, Frontend).
     */
    target: PanelTarget | null;
    /** The target given was applied: it is not given again. */
    targetTaken: (target: PanelTarget) => void;
    place: PanelPlace;
    /**
     * The panel takes the keys: full screen, or the selected tile. In a tile the arrows move among
     * tiles, so a panel there takes letters only (`j`/`k`, `Space`).
     */
    selected: boolean;
    /**
     * Shows something in another panel of the project, at the same zoom: in its tile, which is
     * selected, or full screen in place of this one. The target is in that panel's terms.
     */
    show: (panel: string, target: PanelTarget) => void;
    /** Looks for a text in all the project's files, as `⌘F` does from where no file is open. */
    findInFiles: (query: string) => void;
    /** Shows another folder of the project, at the same zoom. */
    showFolder: (folderId: string) => void;
    /** In a tile: shows the panel full screen, as the tile's own button does. Null full screen. */
    zoomIn: (() => void) | null;
}

/**
 * The parts of a project's row at all projects: the line under its name, and what ends the row.
 */
export type SummaryPart = 'lead' | 'end';

/**
 * What a panel's summary gets: the project of the row it is on, and the part to show. The row
 * shows each summary once per part, so a summary shows nothing in the parts it has nothing for.
 */
export interface PanelSummaryProps {
    project: ProjectInfo;
    /**
     * The project's one folder, whose summary the row shows; null without folder, and with
     * several (their summaries are the project's folders').
     */
    folder: ProjectFolder | null;
    part: SummaryPart;
    /** The project's folder is a repository: false without folder, or for a folder without git. */
    repository: boolean;
}

/** What a panel needs of a project to show anything: a folder (Files), a repository (Changes). */
export type PanelNeed = 'folder' | 'repository';

/**
 * What a module gives the app to show it as a panel. The app lays panels out and switches between
 * them; a panel knows nothing of the others or of where it sits.
 */
export interface PanelDefinition {
    /** Stable: names the panel in shortcuts, saved layouts and the command palette. */
    id: string;
    title: MessageKey;
    icon: ComponentType<{ size?: number; stroke?: number; className?: string }>;
    /** As a tile beside another, the least width it keeps while the window has room. */
    tileMinWidth?: number;
    /** What the project must have for the panel to be among its panels; none, every project. */
    needs?: PanelNeed;
    /**
     * The panel itself, loaded on its first show (one chunk per module). Its queries live inside
     * it, so a panel that is not on screen runs none. It is mounted again for another project, so
     * its state (a selection, a scroll position) always belongs to the project it shows.
     */
    view: Preloadable<PanelProps>;
    /**
     * What the panel tells about a project on its row at all projects (level 0), if anything.
     * A chunk of its own, loaded with level 0; it fetches only what the row shows.
     */
    summary?: Preloadable<PanelSummaryProps>;
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
}: Pick<PanelDefinition, 'id' | 'title' | 'icon' | 'tileMinWidth' | 'needs'> &
    LazyPart<M, PanelProps> & {
        summary?: LazyPart<S, PanelSummaryProps>;
    }): PanelDefinition {
    return {
        ...panel,
        view: preloadable(load, pick),
        summary: summary ? preloadable(summary.load, summary.pick) : undefined,
    };
}
