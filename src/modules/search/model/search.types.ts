import type { ChangeMark } from '@/shared/git/change-mark';

/**
 * Wire contracts with the Rust backend (`src-tauri/src/modules/search/contracts.rs`). Change both
 * sides together.
 */

/** What the command palette asks for, at every key typed. */
export interface SearchRequest {
    query: string;
    /** The panels' titles, in their order: the frontend defines the panels. */
    panels: string[];
    /** The project whose files are searched: the one on screen, none when all projects show. */
    root: string | null;
}

/** Where the query's letters are in a text: UTF-16 offsets `[start, end)`. */
export type Highlight = [start: number, end: number];

interface ProjectMatch {
    root: string;
    name: string;
    /** In the name. */
    highlights: Highlight[];
}

interface PanelMatch {
    /** The panel's position in the request. */
    index: number;
    /** In the title. */
    highlights: Highlight[];
}

/** A file of the project searched: one git lists, or one deleted that Changes lists. */
interface FileMatch {
    path: string;
    /** Null when it did not change. */
    mark: ChangeMark | null;
    /** In the path. */
    highlights: Highlight[];
}

/** The matches, best first in each group. With nothing typed: every project and panel, no files. */
export interface SearchResults {
    projects: ProjectMatch[];
    panels: PanelMatch[];
    files: FileMatch[];
    /** The files that matched past the ones sent. */
    moreFiles: number;
}
