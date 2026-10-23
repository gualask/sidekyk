/**
 * Wire contracts with the Rust backend (`src-tauri/crates/core/src/modules/notes/contracts.rs`).
 * Change both sides together.
 */

/**
 * Whose notes, on the wire: the Inbox's (this name), or a project's (its id). No project id is
 * it: ids are 16 hex digits, and before them absolute paths or `wsl:…`.
 */
export const INBOX_BOOK = 'inbox';

/** Where a move puts its notes: a book, or a project made for them, without folder. */
export type BookTarget = { kind: 'book'; book: string } | { kind: 'newProject'; name: string };

/** The list of its book a moved note goes to: the open one (the Inbox's only one), or a new one. */
export type ListTarget =
    | { kind: 'open' }
    | { kind: 'list'; id: string }
    | { kind: 'new'; name: string };

/** One note: a card of plain text in a list of a book. Times are milliseconds since the epoch. */
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

/** Every note of a book, its lists in the user's order (at least one), and the list open. */
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

/** A note moved, as it is now, and the book it went to (a project made for it included). */
export interface MovedNote {
    to: string;
    note: Note;
}

/** A list moved to another project, handed back to undo it. */
export interface MovedList {
    /** The books. */
    from: string;
    to: string;
    /** The list as it left `from`, brought back there as a deleted list is. */
    left: DeletedList;
    /** The list of `to` that took its notes. */
    into: string;
    /** Whether `into` was there before, a list of the same name: undo leaves it. */
    joined: boolean;
}

/** What a book tells of its notes: a project's card at all projects. */
export interface NotesSummary {
    /** The notes not done. */
    open: number;
    done: number;
    /** When the newest change to a note's text was, null without notes. */
    lastEdited: number | null;
}
