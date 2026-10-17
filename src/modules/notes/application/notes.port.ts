import { createContext, createElement, type ReactNode, useContext } from 'react';
import type { DeletedList, Note, NoteList, ProjectNotes } from '../model/notes.types';

/** The notes' runtime boundary: the native backend, or a fixture in browser dev mode. */
export interface NotesPort {
    getNotes(root: string): Promise<ProjectNotes>;
    /** Writes a new note on top of a list. */
    addNote(root: string, list: string, text: string): Promise<Note>;
    setNoteText(root: string, id: string, text: string): Promise<Note>;
    setNoteDone(root: string, id: string, done: boolean): Promise<Note>;
    /** Moves a note to `index` among the open notes of `list`; the notes whose place changed. */
    placeNote(root: string, id: string, list: string, index: number): Promise<Note[]>;
    /** Puts a note back as it was (undo). */
    restoreNote(root: string, note: Note): Promise<Note>;
    deleteNote(root: string, id: string): Promise<void>;
    /** A new list, last, and open. */
    addList(root: string, name: string): Promise<NoteList>;
    renameList(root: string, id: string, name: string): Promise<NoteList>;
    /** Deletes a list and its notes; what comes back brings them back. */
    deleteList(root: string, id: string): Promise<DeletedList>;
    restoreList(root: string, deleted: DeletedList): Promise<ProjectNotes>;
    /** Remembers the list open, for the next time the project shows. */
    openList(root: string, id: string): Promise<void>;
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
