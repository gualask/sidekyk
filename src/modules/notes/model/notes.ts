import type { Translator } from '@/shared/i18n';
import { timeAgo } from '@/shared/time/relative-time';
import type { Note, NoteList, ProjectNotes } from './notes.types';

/** A card shows this many lines until it is opened. */
const SHOWN_LINES = 4;

/** The open notes of a list, from the top. */
export function openNotes(notes: readonly Note[], list: string): Note[] {
    return notes
        .filter((note) => note.list === list && note.done === null)
        .sort((a, b) => a.position - b.position);
}

/** The done notes of a list, the last done first. */
export function doneNotes(notes: readonly Note[], list: string): Note[] {
    return notes
        .filter((note) => note.list === list && note.done !== null)
        .sort((a, b) => (b.done ?? 0) - (a.done ?? 0));
}

/** The list a book opens on; the first if the one remembered is gone. */
export function openListOf(notes: ProjectNotes): NoteList {
    return notes.lists.find((list) => list.id === notes.openList) ?? notes.lists[0];
}

/** How many notes of each list are open, by list. */
export function openCounts(notes: readonly Note[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const note of notes) {
        if (note.done === null) counts.set(note.list, (counts.get(note.list) ?? 0) + 1);
    }
    return counts;
}

/** The lines of a note, trailing blank ones left out. */
export function lineCount(text: string): number {
    return text.trimEnd().split('\n').length;
}

/** A note's first line that is not blank: what names it in a row (reorder, the palette). */
export function noteTitle(text: string): string {
    return (
        text
            .split('\n')
            .map((line) => line.trim())
            .find((line) => line !== '') ?? ''
    );
}

/** What a card says under its text: when it was written or done, and its length once cut. */
export function noteMeta(note: Note, now: number, i18n: Translator): string {
    const { t } = i18n;
    const at = note.done ?? note.edited;
    const when = timeAgo(Math.floor(at / 1000), Math.floor(now / 1000), i18n);
    const lines = lineCount(note.text);
    return [
        note.done === null ? when : t('notes.doneWhen', { when }),
        lines > SHOWN_LINES ? t('notes.lines', { count: lines }) : '',
    ]
        .filter(Boolean)
        .join(' · ');
}

/** The notes with those changed in place; one no longer there stays gone. */
export function withUpdated(project: ProjectNotes, changed: readonly Note[]): ProjectNotes {
    const byId = new Map(changed.map((note) => [note.id, note]));
    return { ...project, notes: project.notes.map((note) => byId.get(note.id) ?? note) };
}

/** The notes with those given in place, or added when not there: a note written or put back. */
export function withNotes(project: ProjectNotes, notes: readonly Note[]): ProjectNotes {
    const ids = new Set(notes.map((note) => note.id));
    return { ...project, notes: [...project.notes.filter((note) => !ids.has(note.id)), ...notes] };
}

/** The notes without one. */
export function withoutNote(project: ProjectNotes, id: string): ProjectNotes {
    return { ...project, notes: project.notes.filter((note) => note.id !== id) };
}

/**
 * The position a note takes at `index` among the open notes of a list, as the backend gives it:
 * between its new neighbors. Shown at once, before the backend answers.
 */
export function positionAt(open: readonly Note[], id: string, index: number): number {
    const others = open.filter((note) => note.id !== id);
    const at = Math.max(0, Math.min(index, others.length));
    const before = others[at - 1]?.position;
    const after = others[at]?.position;
    if (before === undefined) return after === undefined ? 0 : after - 1;
    if (after === undefined) return before + 1;
    return (before + after) / 2;
}
