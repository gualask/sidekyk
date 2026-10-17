import type { PanelTarget } from '@/shared/panels/panel';

/**
 * What Notes is asked to show: a list (null: the one open), one of its notes to bring into view,
 * and whether its field takes the focus, for a new note.
 */
export interface NotesShown {
    list: string | null;
    note: string | null;
    write: boolean;
}

/** Asks Notes to open a list, and to bring one of its notes into view. */
export function notesTarget(list: string, note: string | null = null): PanelTarget {
    const shown: NotesShown = { list, note, write: false };
    return { key: JSON.stringify(shown) };
}

/** Asks Notes for a new note, in the list open (`⌘N`). */
export function newNoteTarget(): PanelTarget {
    const shown: NotesShown = { list: null, note: null, write: true };
    return { key: JSON.stringify(shown) };
}

function isShown(value: unknown): value is NotesShown {
    return (
        typeof value === 'object' &&
        value !== null &&
        'list' in value &&
        (value.list === null || typeof value.list === 'string') &&
        'note' in value &&
        (value.note === null || typeof value.note === 'string') &&
        'write' in value &&
        typeof value.write === 'boolean'
    );
}

/** What a target asks Notes to show, or null when it is not one of Notes'. */
export function notesShownBy(target: PanelTarget): NotesShown | null {
    try {
        const value: unknown = JSON.parse(target.key);
        return isShown(value) ? value : null;
    } catch {
        return null;
    }
}
