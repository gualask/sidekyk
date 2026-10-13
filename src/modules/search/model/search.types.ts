import type { ChangeArea } from '@/shared/git/change-area';

/**
 * Wire contracts with the Rust backend (`src-tauri/src/modules/search/contracts.rs`). Change both
 * sides together.
 */

/** What the command palette asks for, at every key typed. */
export interface SearchRequest {
    query: string;
    /** The panels' titles, in their order: the frontend defines the panels. */
    panels: string[];
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

/** A changed file of the project on screen, in one area. */
interface FileMatch {
    path: string;
    area: ChangeArea;
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
