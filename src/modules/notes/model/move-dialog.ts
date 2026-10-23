import type { ProjectInfo, ProjectLocation } from '@/shared/projects/project-info';
import { projectFolder } from '@/shared/projects/project-info';
import { openListOf } from './notes';
import {
    type BookTarget,
    INBOX_BOOK,
    type ListTarget,
    type Note,
    type NoteList,
    type ProjectNotes,
} from './notes.types';

/** What the Move dialog moves: a note of a book, or a whole list of a project. */
export type MoveSubject =
    | { kind: 'note'; book: string; note: Note }
    | { kind: 'list'; book: string; list: NoteList };

/** A book to move to: the Inbox, or a project. */
export interface MoveBook {
    book: string;
    name: string;
    /** What tells two projects of the same name apart; null for the Inbox. */
    folder: ProjectLocation | null;
}

/**
 * The books a subject can go to, in their order: a note of the Inbox to the projects; a note of a
 * project to the Inbox and the projects, its own included (another of its lists); a list to the
 * other projects.
 */
export function moveBooks(
    subject: MoveSubject,
    projects: readonly ProjectInfo[],
    inboxName: string,
): MoveBook[] {
    const books = projects.map((project) => ({
        book: project.id,
        name: project.name,
        folder: projectFolder(project),
    }));
    if (subject.kind === 'list') return books.filter((book) => book.book !== subject.book);
    if (subject.book === INBOX_BOOK) return books;
    return [{ book: INBOX_BOOK, name: inboxName, folder: null }, ...books];
}

/** The books whose name another has too, case aside: their folders tell them apart. */
export function namesShared(books: readonly MoveBook[]): Set<MoveBook> {
    const count = new Map<string, number>();
    const names = books.map((book) => book.name.toLocaleLowerCase());
    for (const name of names) count.set(name, (count.get(name) ?? 0) + 1);
    return new Set(books.filter((_, index) => (count.get(names[index]) ?? 0) > 1));
}

/** Whether `book` is the one a moved note is in: its other lists, not a move to the book. */
function noteHome(subject: MoveSubject, book: string): boolean {
    return subject.kind === 'note' && subject.book === book;
}

/**
 * The dialog's field: the book chosen as a chip (a note only), and what is typed after it, a book
 * without a chip, a list of the chip's project with one.
 */
export interface MoveState {
    chip: MoveBook | null;
    query: string;
}

/** A note of a project starts with its project as the chip: its other lists come first. */
export function initialMove(subject: MoveSubject, books: readonly MoveBook[]): MoveState {
    return { chip: books.find((book) => noteHome(subject, book.book)) ?? null, query: '' };
}

/**
 * What the field suggests from: the books without a chip; with a project's chip, its lists (the
 * note's own list aside, once they are read); nothing with the Inbox's, which has no list to pick.
 */
export type MoveStep =
    | { kind: 'books'; books: readonly MoveBook[] }
    | { kind: 'lists'; lists: readonly NoteList[] }
    | { kind: 'none' };

export function moveStep(
    subject: MoveSubject,
    chip: MoveBook | null,
    books: readonly MoveBook[],
    chipNotes: ProjectNotes | undefined,
): MoveStep {
    if (!chip) return { kind: 'books', books };
    if (chip.book === INBOX_BOOK || !chipNotes) return { kind: 'none' };
    const own = subject.kind === 'note' && noteHome(subject, chip.book) ? subject.note.list : null;
    return { kind: 'lists', lists: chipNotes.lists.filter((list) => list.id !== own) };
}

/** The names a step's suggestions are ranked by. */
export function stepNames(step: MoveStep): string[] {
    if (step.kind === 'books') return step.books.map((book) => book.name);
    if (step.kind === 'lists') return step.lists.map((list) => list.name);
    return [];
}

/** A suggestion: a book, a list, or what `↵` makes when the text names none. */
export type MoveRow =
    | { kind: 'book'; book: MoveBook }
    | { kind: 'list'; list: NoteList }
    | { kind: 'newProject'; name: string }
    | { kind: 'newList'; name: string };

/**
 * The suggestions: the step's books or lists, all in their order with nothing typed or until
 * ranked, else as `ranked` orders them (their indices, best first). Typed text that is not exactly a name (case
 * aside) gets a last row saying what `↵` makes of it, never hidden, so a typo cannot make a
 * project unseen.
 */
export function moveRows(
    step: MoveStep,
    query: string,
    ranked: readonly number[] | null,
): MoveRow[] {
    if (step.kind === 'none') return [];
    const typed = query.trim();
    const names = stepNames(step);
    const order = typed && ranked ? ranked : names.keys();
    const rows: MoveRow[] = [...order].map((index) =>
        step.kind === 'books'
            ? { kind: 'book', book: step.books[index] }
            : { kind: 'list', list: step.lists[index] },
    );
    const exact = typed.toLocaleLowerCase();
    if (typed && !names.some((name) => name.toLocaleLowerCase() === exact)) {
        rows.push({ kind: step.kind === 'books' ? 'newProject' : 'newList', name: typed });
    }
    return rows;
}

/**
 * `Tab`: the book chosen becomes the chip, its lists next (a note only: a list goes whole). The
 * state unchanged when nothing completes.
 */
export function completed(subject: MoveSubject, state: MoveState, row: MoveRow | null): MoveState {
    if (subject.kind !== 'note' || row?.kind !== 'book') return state;
    return { chip: row.book, query: '' };
}

/** Backspace on the empty field takes the chip away; null when it does nothing. */
export function withoutChip(state: MoveState): MoveState | null {
    return state.chip && state.query === '' ? { chip: null, query: '' } : null;
}

/** A move `↵` asks for: where, and what its toast names. */
export interface Move {
    to: BookTarget;
    /** Into which list of `to`; a list moved goes whole and ignores it. */
    list: ListTarget;
    /** The book, or the list when the note stays in its book. */
    name: string;
}

/** What `↵` does: a move, the chip completed (the note's own project), or nothing. */
export type Entered = { kind: 'move'; move: Move } | { kind: 'chip'; state: MoveState } | null;

/**
 * What `↵` does with the row chosen, if any. A book chosen moves into the list it opens on, but
 * the note's own project completes into the chip, for another of its lists. With a chip and no row,
 * the note goes into the list the chip's project opens on: nothing when that is the note's list.
 */
export function entered(
    subject: MoveSubject,
    state: MoveState,
    row: MoveRow | null,
    chipNotes: ProjectNotes | undefined,
): Entered {
    const open: ListTarget = { kind: 'open' };
    const move = (to: BookTarget, list: ListTarget, name: string): Entered => ({
        kind: 'move',
        move: { to, list, name },
    });
    const { chip } = state;
    if (!chip) {
        if (row?.kind === 'newProject')
            return move({ kind: 'newProject', name: row.name }, open, row.name);
        if (row?.kind !== 'book') return null;
        if (noteHome(subject, row.book.book)) {
            return { kind: 'chip', state: completed(subject, state, row) };
        }
        return move({ kind: 'book', book: row.book.book }, open, row.book.name);
    }
    const to: BookTarget = { kind: 'book', book: chip.book };
    // within the note's own project the toast names the list, elsewhere the project
    const stays = noteHome(subject, chip.book);
    const named = (list: string) => (stays ? list : chip.name);
    if (row?.kind === 'list')
        return move(to, { kind: 'list', id: row.list.id }, named(row.list.name));
    if (row?.kind === 'newList') return move(to, { kind: 'new', name: row.name }, named(row.name));
    if (!stays) return move(to, open, chip.name);
    if (!chipNotes) return null;
    const list = openListOf(chipNotes);
    if (subject.kind === 'note' && subject.note.list === list.id) return null;
    return move(to, open, list.name);
}
