import type { PanelTarget } from '@/shared/panels/panel';

/** What Notes is asked to show: a list, and one of its notes to bring into view, if any. */
export interface NotesShown {
    list: string;
    note: string | null;
}

/** Asks Notes to open a list, and to bring one of its notes into view. */
export function notesTarget(list: string, note: string | null = null): PanelTarget {
    const shown: NotesShown = { list, note };
    return { key: JSON.stringify(shown) };
}

function isShown(value: unknown): value is NotesShown {
    return (
        typeof value === 'object' &&
        value !== null &&
        'list' in value &&
        typeof value.list === 'string' &&
        'note' in value &&
        (value.note === null || typeof value.note === 'string')
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
