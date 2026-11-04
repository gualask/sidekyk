export { type MoveTargets, MoveTargetsProvider } from './application/move-targets';
export { type ImageDrop, type NotesPort, NotesProvider } from './application/notes.port';
// `addFiles` for the browser fixtures too, which add a drop's files as the app does
export { addFiles, useCaptures, useForgetBooks } from './application/notes.queries';
export { NotesSettingsProvider } from './application/notes-settings';
// for the browser fixtures, which keep notes as the backend does
export {
    doneNotes,
    imageFile,
    noteTitle,
    openNotes,
    positionAt,
    sourceImage,
} from './model/notes';
export {
    type BookTarget,
    type CaptureEvent,
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
export { QuickNote } from './ui/QuickNote';

/** Asks about a project's notes before it is removed; loaded with the first removal. */
export const loadRemoveProjectDialog = () => import('./ui/RemoveProjectDialog');
