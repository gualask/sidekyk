/**
 * Wire contracts with the Rust backend (`src-tauri/crates/core/src/modules/notes/contracts.rs`).
 * Change both sides together.
 */

/**
 * Whose notes, on the wire: the Inbox's (this name), or a project's (its id). No project id is
 * it: ids are 16 hex digits, and before them absolute paths or `wsl:…`.
 */
export const INBOX_BOOK = 'inbox';

/** The list of its book a moved note goes to: the open one (the Inbox's only one), or a new one. */
export type ListTarget =
    | { kind: 'open' }
    | { kind: 'list'; id: string }
    | { kind: 'new'; name: string };

/** The formats a note takes: those every webview shows. */
type ImageKind = 'png' | 'jpeg' | 'gif' | 'webp';

/** An image of a note, kept beside its notes as given, with a thumbnail for the cards. */
export interface NoteImage {
    id: string;
    kind: ImageKind;
    /** In pixels, as shown. */
    width: number;
    height: number;
    /** The size of its file. */
    bytes: number;
    /** Its marks and the image under them, when it is that image marked. */
    marked: MarkedImage | null;
}

/** An image marked: a PNG drawn with its marks over the image as given, kept so they stay editable. */
interface MarkedImage {
    /** The image as given, as large as the marked one. */
    source: { id: string; kind: ImageKind; bytes: number };
    /** In the order they were placed, the last drawn on top. */
    marks: Mark[];
}

/** A point in an image's pixels. */
export interface MarkPoint {
    x: number;
    y: number;
}

/**
 * A label on an image, a letter or a text, with a tail pointing at a spot; a tail with no text is
 * a plain arrow. `x` and `y`, the label's middle, in the image's pixels.
 */
export interface Mark extends MarkPoint {
    text: string;
    tail: MarkPoint | null;
}

/** The note images go to: one there, or a new one on top of a list. */
export type ImageTarget = { kind: 'note'; id: string } | { kind: 'new'; list: string };

/**
 * Where a capture goes, as the entry that started it says (`modules/capture`, `CaptureInto`): the
 * place last chosen for a capture (the global shortcut, the tray, the capture window's +), or a
 * list or a note of a book (a Notes field, a note's "Add capture").
 */
export type CaptureInto = { kind: 'last' } | { kind: 'into'; book: string; target: ImageTarget };

/**
 * How a capture ended (`modules/capture` in the backend, `CaptureEvent`): an area picked, a crop
 * the backend holds until a note takes it (`writeCapture`) or its draft drops it; the system not
 * letting Sidekyk read the screen; a failure. A cancel tells nothing.
 */
export type CaptureEvent =
    | { kind: 'taken'; crop: string; width: number; height: number; into: CaptureInto }
    | { kind: 'refused' }
    | { kind: 'failed' };

/**
 * An image of a capture's note, as written: a crop, or one of the note's own marked anew; `drawn`
 * the PNG of `marks` over the image under them, none without marks.
 */
export type CaptureImage =
    | { kind: 'crop'; crop: string; marks: Mark[]; drawn: Uint8Array<ArrayBuffer> | null }
    | { kind: 'image'; id: string; marks: Mark[]; drawn: Uint8Array<ArrayBuffer> | null };

/** A capture's note, written in one step: where, its text (none: unchanged), its images. */
export interface CaptureWrite {
    book: string;
    target: ImageTarget;
    text: string | null;
    images: CaptureImage[];
}

/**
 * One note: a card of plain text in a list of a book, its images below the text. Times are
 * milliseconds since the epoch.
 */
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
    /** In the order they came in. */
    images: NoteImage[];
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

/** A note moved, as it is now, and the book it went to. */
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

/** How many notes a book has: the open ones on a project's row, all of them before its removal. */
export interface NotesCount {
    /** The notes not done. */
    open: number;
    done: number;
}
