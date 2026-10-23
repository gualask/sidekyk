import { useState } from 'react';
import { useCopyToClipboard } from '@/shared/ui/hooks/use-copy-to-clipboard';
import type { Note } from '../model/notes.types';

/**
 * What the cards of a column share: the one being edited (kept while it scrolls out of view) and
 * the one just copied. Gives each card its part, as `NoteCard` takes it.
 */
export function useCardStates() {
    const [editing, setEditing] = useState<string | null>(null);
    const { copied, copy } = useCopyToClipboard();
    return (note: Note) => ({
        editing: editing === note.id,
        onEdit: (on: boolean) => setEditing(on ? note.id : null),
        copied: copied?.id === note.id ? copied : null,
        onCopy: () => void copy(note.id, note.text),
    });
}
