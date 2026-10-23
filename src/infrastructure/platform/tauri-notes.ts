import { invoke } from '@tauri-apps/api/core';

import type { NotesPort } from '@/modules/notes';

/** Native notes adapter: the commands in `src-tauri/src/interfaces/tauri/notes.rs`. */
export const tauriNotes: NotesPort = {
    getNotes: (book) => invoke('get_notes', { book }),
    addNote: (book, list, text) => invoke('add_note', { book, list, text }),
    setNoteText: (book, id, text) => invoke('set_note_text', { book, id, text }),
    setNoteDone: (book, id, done) => invoke('set_note_done', { book, id, done }),
    placeNote: (book, id, list, index) => invoke('place_note', { book, id, list, index }),
    restoreNote: (book, note) => invoke('restore_note', { book, note }),
    deleteNote: (book, id) => invoke('delete_note', { book, id }),
    moveNote: (from, id, to, list) => invoke('move_note', { from, id, to, list }),
    unmoveNote: (at, original, home) => invoke('unmove_note', { at, original, home }),
    moveList: (from, list, to) => invoke('move_list', { from, list, to }),
    unmoveList: (moved) => invoke('unmove_list', { moved }),
    addList: (book, name) => invoke('add_note_list', { book, name }),
    renameList: (book, id, name) => invoke('rename_note_list', { book, id, name }),
    deleteList: (book, id) => invoke('delete_note_list', { book, id }),
    restoreList: (book, deleted) => invoke('restore_note_list', { book, deleted }),
    openList: (book, id) => invoke('open_note_list', { book, id }),
    notesSummary: (book) => invoke('notes_summary', { book }),
    countNotes: (book) => invoke('count_notes', { book }),
    exportNotes: (projectId) => invoke('export_notes', { projectId }),
};
