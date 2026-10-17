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

/** A line where the text searched is: its number, its text (cut around the first match when long,
 * `…` marking a cut) and where the text is in it. */
interface ContentLine {
    number: number;
    text: string;
    highlights: Highlight[];
}

/** A file's lines where the text searched is, in order. */
export interface ContentFile {
    path: string;
    lines: ContentLine[];
}

/** How a search in contents ended, once its files were all sent. */
export interface ContentEnd {
    /** More lines matched than were sent: the search stopped there. */
    more: boolean;
    /** A newer search, or the palette closing, stopped this one. */
    cancelled: boolean;
}
