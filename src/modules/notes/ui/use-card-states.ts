import { useState } from 'react';
import { useCopyToClipboard } from '@/shared/ui/hooks/use-copy-to-clipboard';
import { useNotesPort } from '../application/notes.port';
import type { Note } from '../model/notes.types';

/**
 * What the cards of a column share: the one being edited (kept while it scrolls out of view) and
 * the one just copied. Gives each card its part, as `NoteCard` takes it; `edit` opens a card (a
 * note of images just added, to write its text). A note with images is copied as the backend
 * makes it: its text, then where its images are.
 */
export function useCardStates(book: string) {
    const port = useNotesPort();
    const [editing, setEditing] = useState<string | null>(null);
    const { copied, copy } = useCopyToClipboard();
    const cardState = (note: Note) => ({
        editing: editing === note.id,
        onEdit: (on: boolean) => setEditing(on ? note.id : null),
        copied: copied?.id === note.id ? copied : null,
        onCopy: () =>
            void copy(note.id, note.images.length === 0 ? note.text : port.copyNote(book, note.id)),
    });
    return { cardState, edit: setEditing };
}
