import { createContext, createElement, type ReactNode, useContext } from 'react';
import type {
    BookTarget,
    DeletedList,
    ListTarget,
    MovedList,
    MovedNote,
    Note,
    NoteList,
    NotesSummary,
    ProjectNotes,
} from '../model/notes.types';

/**
 * The notes' runtime boundary: the native backend, or a fixture in browser dev mode. `book` is
 * `INBOX_BOOK` or a project's id; the Inbox refuses lists, done and order.
 */
export interface NotesPort {
    getNotes(book: string): Promise<ProjectNotes>;
    /** Writes a new note on top of a list. */
    addNote(book: string, list: string, text: string): Promise<Note>;
    setNoteText(book: string, id: string, text: string): Promise<Note>;
    setNoteDone(book: string, id: string, done: boolean): Promise<Note>;
    /** Moves a note to `index` among the open notes of `list`; the notes whose place changed. */
    placeNote(book: string, id: string, list: string, index: number): Promise<Note[]>;
    /** Puts a note back as it was (undo). */
    restoreNote(book: string, note: Note): Promise<Note>;
    deleteNote(book: string, id: string): Promise<void>;
    /**
     * Moves a note to another book, or another list of its own, keeping its id: on top of the
     * list's open notes; done stays done, but in the Inbox.
     */
    moveNote(from: string, id: string, to: BookTarget, list: ListTarget): Promise<MovedNote>;
    /** Puts a moved note back in `home` as `original` was, and takes it out of `at` (undo). */
    unmoveNote(at: string, original: Note, home: string): Promise<Note>;
    /** Moves a list with its notes to another project: into its list of the same name, else last. */
    moveList(from: string, list: string, to: BookTarget): Promise<MovedList>;
    /** Brings a moved list back where it was, with its notes (undo). */
    unmoveList(moved: MovedList): Promise<void>;
    /** A new list, last, and open. */
    addList(book: string, name: string): Promise<NoteList>;
    renameList(book: string, id: string, name: string): Promise<NoteList>;
    /** Deletes a list and its notes; what comes back brings them back. */
    deleteList(book: string, id: string): Promise<DeletedList>;
    restoreList(book: string, deleted: DeletedList): Promise<ProjectNotes>;
    /** Remembers the list open, for the next time the book shows. */
    openList(book: string, id: string): Promise<void>;
    /** What a book tells of its notes: a project's card at all projects. */
    notesSummary(book: string): Promise<NotesSummary>;
    /** How many notes a book has, open and done: what removing a project would delete. */
    countNotes(book: string): Promise<number>;
    /** Asks where to save a project's notes as Markdown and saves them; the path, or null. */
    exportNotes(projectId: string): Promise<string | null>;
}

const NotesPortContext = createContext<NotesPort | null>(null);

export function NotesProvider({ value, children }: { value: NotesPort; children: ReactNode }) {
    return createElement(NotesPortContext.Provider, { value }, children);
}

export function useNotesPort(): NotesPort {
    const port = useContext(NotesPortContext);
    if (!port) {
        throw new Error('useNotesPort must be used within NotesProvider');
    }
    return port;
}
