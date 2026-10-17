export { type NotesPort, NotesProvider } from './application/notes.port';
// for the browser fixtures, which keep notes as the backend does
export { doneNotes, noteTitle, openNotes, positionAt } from './model/notes';
export type { DeletedList, Note, NoteList, ProjectNotes } from './model/notes.types';
export { notesTarget } from './model/targets';
export { notesPanel } from './panel';
