import { IconNotes } from '@tabler/icons-react';
import { definePanel } from '@/shared/panels/panel';

export const notesPanel = definePanel({
    id: 'notes',
    title: 'Notes',
    icon: IconNotes,
    load: () => import('./ui/NotesWorkspace'),
    pick: (module) => module.NotesWorkspace,
});
