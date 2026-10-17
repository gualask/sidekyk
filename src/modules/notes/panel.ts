import { IconNotes } from '@tabler/icons-react';
import { definePanel } from '@/shared/panels/panel';

export const notesPanel = definePanel({
    id: 'notes',
    title: 'Notes',
    icon: IconNotes,
    // cards need the room: a few words a line at least
    tileMinWidth: 320,
    load: () => import('./ui/NotesWorkspace'),
    pick: (module) => module.NotesWorkspace,
});
