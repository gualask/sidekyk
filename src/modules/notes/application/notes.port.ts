import { createContext, createElement, type ReactNode, useContext } from 'react';
import type { DeletedList, Note, NoteList, NotesSummary, ProjectNotes } from '../model/notes.types';

/** The notes' runtime boundary: the native backend, or a fixture in browser dev mode. */
export interface NotesPort {
    getNotes(projectId: string): Promise<ProjectNotes>;
    /** Writes a new note on top of a list. */
    addNote(projectId: string, list: string, text: string): Promise<Note>;
    setNoteText(projectId: string, id: string, text: string): Promise<Note>;
    setNoteDone(projectId: string, id: string, done: boolean): Promise<Note>;
    /** Moves a note to `index` among the open notes of `list`; the notes whose place changed. */
    placeNote(projectId: string, id: string, list: string, index: number): Promise<Note[]>;
    /** Puts a note back as it was (undo). */
    restoreNote(projectId: string, note: Note): Promise<Note>;
    deleteNote(projectId: string, id: string): Promise<void>;
    /** A new list, last, and open. */
    addList(projectId: string, name: string): Promise<NoteList>;
    renameList(projectId: string, id: string, name: string): Promise<NoteList>;
    /** Deletes a list and its notes; what comes back brings them back. */
    deleteList(projectId: string, id: string): Promise<DeletedList>;
    restoreList(projectId: string, deleted: DeletedList): Promise<ProjectNotes>;
    /** Remembers the list open, for the next time the project shows. */
    openList(projectId: string, id: string): Promise<void>;
    /** What a project's card at all projects tells of its notes. */
    notesSummary(projectId: string): Promise<NotesSummary>;
    /** How many notes a project has, open and done: what removing it would delete. */
    countNotes(projectId: string): Promise<number>;
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
