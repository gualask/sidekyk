import { relativeTime } from '@/shared/time/relative-time';
import type { Note, ProjectNotes } from './notes.types';

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

/** What a card says under its text: when it was written or done, and its length once cut. */
export function noteMeta(note: Note, now: number): string {
    const at = note.done ?? note.edited;
    const ago = relativeTime(Math.floor(at / 1000), Math.floor(now / 1000));
    const when = ago === 'now' ? 'just now' : `${ago} ago`;
    const lines = lineCount(note.text);
    return [note.done === null ? when : `done ${when}`, lines > SHOWN_LINES ? `${lines} lines` : '']
        .filter(Boolean)
        .join(' · ');
}

/** The notes with those changed in place, and those not there yet added. */
export function withNotes(project: ProjectNotes, changed: readonly Note[]): ProjectNotes {
    const byId = new Map(changed.map((note) => [note.id, note]));
    const notes = project.notes.map((note) => {
        const next = byId.get(note.id);
        if (next) byId.delete(note.id);
        return next ?? note;
    });
    return { ...project, notes: [...notes, ...byId.values()] };
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
