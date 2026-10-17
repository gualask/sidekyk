/**
 * Wire contracts with the Rust backend (`src-tauri/src/modules/notes/contracts.rs`). Change both
 * sides together.
 */

/** One note: a card of plain text in a list of a project. Times are milliseconds since the epoch. */
export interface Note {
    id: string;
    /** The list it is in. */
    list: string;
    /** Its place among the open notes of its list, lowest on top; only the order means anything. */
    position: number;
    text: string;
    created: number;
    /** When its text last changed. */
    edited: number;
    /** When it was marked done, or null while open. */
    done: number | null;
}

/** A list of notes, by topic. */
export interface NoteList {
    id: string;
    name: string;
}

/** Every note of a project, its lists in the user's order (at least one), and the list open. */
export interface ProjectNotes {
    lists: NoteList[];
    /** In no particular order. */
    notes: Note[];
    openList: string;
}

/** A list deleted with its notes, handed back to bring them all back (undo). */
export interface DeletedList {
    list: NoteList;
    /** Where it was among the lists. */
    index: number;
    notes: Note[];
}

/** What a project's card at all projects tells of its notes. */
export interface NotesSummary {
    /** The notes not done. */
    open: number;
    /** The first line of the open note written last. */
    newest: string | null;
}
