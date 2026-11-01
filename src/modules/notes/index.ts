export { type MoveTargets, MoveTargetsProvider } from './application/move-targets';
export { type ImageDrop, type NotesPort, NotesProvider } from './application/notes.port';
// for the browser fixtures, which add a drop's files as the app does
export { addFiles } from './application/notes.queries';
export { NotesSettingsProvider } from './application/notes-settings';
// for the browser fixtures, which keep notes as the backend does
export { doneNotes, imageFile, noteTitle, openNotes, positionAt } from './model/notes';
export {
    type BookTarget,
    type DeletedList,
    type ImageTarget,
    INBOX_BOOK,
    type ListTarget,
    type MovedList,
    type Note,
    type NoteImage,
    type NoteList,
    type ProjectNotes,
} from './model/notes.types';
export { newNoteTarget, notesTarget } from './model/targets';
export { notesPanel } from './panel';
export { InboxColumn } from './ui/InboxColumn';

/** Asks about a project's notes before it is removed; loaded with the first removal. */
export const loadRemoveProjectDialog = () => import('./ui/RemoveProjectDialog');
