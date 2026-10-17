export { type NotesPort, NotesProvider } from './application/notes.port';
export { useRereadNotes } from './application/notes.queries';
export { NotesSettingsProvider } from './application/notes-settings';
// for the browser fixtures, which keep notes as the backend does
export { doneNotes, noteTitle, openNotes, positionAt } from './model/notes';
export type { DeletedList, Note, NoteList, ProjectNotes } from './model/notes.types';
export { newNoteTarget, notesTarget } from './model/targets';
export { notesPanel } from './panel';

/** Asks about a project's notes before it is removed; loaded with the first removal. */
export const loadRemoveProjectDialog = () => import('./ui/RemoveProjectDialog');
