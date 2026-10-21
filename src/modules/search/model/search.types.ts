import type { ChangeMark } from '@/shared/git/change-mark';
import type { ProjectLocation } from '@/shared/projects/project-info';

/**
 * Wire contracts with the Rust backend (`src-tauri/crates/core/src/modules/search/contracts.rs`).
 * Change both sides together.
 */

/** What the command palette asks for, at every key typed. */
export interface SearchRequest {
    query: string;
    /** The panels' titles, in their order: the frontend defines the panels. */
    panels: string[];
    /** The project whose files are searched: the one on screen, none when all projects show. */
    projectId: string | null;
}

/** Where the query's letters are in a text: UTF-16 offsets `[start, end)`. */
export type Highlight = [start: number, end: number];

interface ProjectMatch {
    id: string;
    name: string;
    /** Where it is, so two of one name can be told apart. */
    location: ProjectLocation;
    /** How well it matched, comparable with the query's other matches: the palette mixes them. */
    score: number;
    /** In the name. */
    highlights: Highlight[];
}

interface PanelMatch {
    /** The panel's position in the request. */
    index: number;
    /** As `ProjectMatch.score`. */
    score: number;
    /** In the title. */
    highlights: Highlight[];
}

/** A file of the project searched: one git lists, or one deleted that Changes lists. */
interface FileMatch {
    path: string;
    /** Null when it did not change. */
    mark: ChangeMark | null;
    /** As `ProjectMatch.score`. */
    score: number;
    /** In the path. */
    highlights: Highlight[];
}

/** A list of notes of the project searched. */
interface ListMatch {
    id: string;
    name: string;
    /** As `ProjectMatch.score`. */
    score: number;
    /** In the name. */
    highlights: Highlight[];
}

/** Part of a note around the text found in it, on one line, `…` where cut. */
interface Snippet {
    text: string;
    highlights: Highlight[];
}

/** A note of the project searched, holding every word typed. */
interface NoteMatch {
    id: string;
    list: string;
    listName: string;
    /** Its first line that is not blank. */
    title: string;
    /** As `ProjectMatch.score`. */
    score: number;
    /** In the title; none when the words are not all in it. */
    highlights: Highlight[];
    /** Where the first word is in the note, when they are not all in the title. */
    snippet: Snippet | null;
}

/**
 * The matches, best first in each group. Projects only when no project is searched, its own
 * files, lists and notes then. With nothing typed: every project or panel, no files, lists or
 * notes.
 */
export interface SearchResults {
    projects: ProjectMatch[];
    panels: PanelMatch[];
    files: FileMatch[];
    /** The files that matched past the ones sent. */
    moreFiles: number;
    lists: ListMatch[];
    notes: NoteMatch[];
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
