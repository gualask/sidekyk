import { invoke } from '@tauri-apps/api/core';

import type { NotesPort } from '@/modules/notes';

/** Native notes adapter: the commands in `src-tauri/src/interfaces/tauri/notes.rs`. */
export const tauriNotes: NotesPort = {
    getNotes: (projectId) => invoke('get_notes', { projectId }),
    addNote: (projectId, list, text) => invoke('add_note', { projectId, list, text }),
    setNoteText: (projectId, id, text) => invoke('set_note_text', { projectId, id, text }),
    setNoteDone: (projectId, id, done) => invoke('set_note_done', { projectId, id, done }),
    placeNote: (projectId, id, list, index) => invoke('place_note', { projectId, id, list, index }),
    restoreNote: (projectId, note) => invoke('restore_note', { projectId, note }),
    deleteNote: (projectId, id) => invoke('delete_note', { projectId, id }),
    addList: (projectId, name) => invoke('add_note_list', { projectId, name }),
    renameList: (projectId, id, name) => invoke('rename_note_list', { projectId, id, name }),
    deleteList: (projectId, id) => invoke('delete_note_list', { projectId, id }),
    restoreList: (projectId, deleted) => invoke('restore_note_list', { projectId, deleted }),
    openList: (projectId, id) => invoke('open_note_list', { projectId, id }),
    notesSummary: (projectId) => invoke('notes_summary', { projectId }),
    countNotes: (projectId) => invoke('count_notes', { projectId }),
    exportNotes: (projectId) => invoke('export_notes', { projectId }),
};
