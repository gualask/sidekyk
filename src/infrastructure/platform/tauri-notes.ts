import { invoke } from '@tauri-apps/api/core';

import type { NotesPort } from '@/modules/notes';

/** Native notes adapter: the commands in `src-tauri/src/interfaces/tauri/notes.rs`. */
export const tauriNotes: NotesPort = {
    getNotes: (root) => invoke('get_notes', { root }),
    addNote: (root, list, text) => invoke('add_note', { root, list, text }),
    setNoteText: (root, id, text) => invoke('set_note_text', { root, id, text }),
    setNoteDone: (root, id, done) => invoke('set_note_done', { root, id, done }),
    placeNote: (root, id, list, index) => invoke('place_note', { root, id, list, index }),
    restoreNote: (root, note) => invoke('restore_note', { root, note }),
    deleteNote: (root, id) => invoke('delete_note', { root, id }),
    addList: (root, name) => invoke('add_note_list', { root, name }),
    renameList: (root, id, name) => invoke('rename_note_list', { root, id, name }),
    deleteList: (root, id) => invoke('delete_note_list', { root, id }),
    restoreList: (root, deleted) => invoke('restore_note_list', { root, deleted }),
    openList: (root, id) => invoke('open_note_list', { root, id }),
    countNotes: (root) => invoke('count_notes', { root }),
    exportNotes: (root) => invoke('export_notes', { root }),
};
