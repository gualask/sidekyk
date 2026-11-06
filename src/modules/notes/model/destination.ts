import type { ProjectInfo, ProjectLocation } from '@/shared/projects/project-info';
import { projectFolder } from '@/shared/projects/project-info';
import { openListOf } from './notes';
import {
    INBOX_BOOK,
    type ListTarget,
    type Note,
    type NoteList,
    type ProjectNotes,
} from './notes.types';

/**
 * What a destination field sends somewhere: a note of a book or a whole list of a project (the
 * Move dialog), or a note being written (the quick note), which starts for the Inbox.
 */
export type MoveSubject =
    | { kind: 'note'; book: string; note: Note }
    | { kind: 'list'; book: string; list: NoteList }
    | { kind: 'new' };

/** What the Move dialog moves: a note of a book, or a whole list of a project. */
export type Moving = Exclude<MoveSubject, { kind: 'new' }>;

/** A book to send to: the Inbox, or a project. */
export interface MoveBook {
    book: string;
    name: string;
    /** What tells two projects of the same name apart; null for the Inbox. */
    folder: ProjectLocation | null;
}

/**
 * The books a subject can go to, in their order: a note of the Inbox to the projects; a note of a
 * project, or one being written, to the Inbox and the projects (a project note's own included:
 * another of its lists); a list to the other projects.
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
    if (subject.kind === 'note' && subject.book === INBOX_BOOK) return books;
    return [{ book: INBOX_BOOK, name: inboxName, folder: null }, ...books];
}

/** The books whose name another has too, case aside: their folders tell them apart. */
export function namesShared(books: readonly MoveBook[]): Set<MoveBook> {
    const count = new Map<string, number>();
    const names = books.map((book) => book.name.toLocaleLowerCase());
    for (const name of names) count.set(name, (count.get(name) ?? 0) + 1);
    return new Set(books.filter((_, index) => (count.get(names[index]) ?? 0) > 1));
}

/** Whether `book` is a moved note's own: another of its lists, not a move to the book. */
function noteHome(subject: MoveSubject, book: string): boolean {
    return subject.kind === 'note' && subject.book === book;
}

/** A list chosen of the chosen project: one it has, or one to make. */
type ListChoice = { kind: 'list'; list: NoteList } | { kind: 'newList'; name: string };

/** A suggestion: a book, a list, or a list to make of a text that names none. */
export type MoveRow = { kind: 'book'; book: MoveBook } | ListChoice;

/** The name a suggestion or a list's chip shows. */
export function choiceName(choice: MoveRow): string {
    if (choice.kind === 'book') return choice.book.name;
    if (choice.kind === 'list') return choice.list.name;
    return choice.name;
}

/**
 * A destination field: the book chosen as a chip, then the list chosen of it as a second chip (a
 * note only), and what is typed after them: a book without a chip, a list of the chip's project
 * with one.
 */
export interface MoveState {
    chip: MoveBook | null;
    /** None with a project's chip: the list it opens on. */
    list: ListChoice | null;
    query: string;
}

/**
 * The chip a field starts with: a project note's own project (its other lists come first), the
 * Inbox for a note being written, none for an Inbox note or a list.
 */
export function initialMove(subject: MoveSubject, books: readonly MoveBook[]): MoveState {
    const own = subject.kind === 'new' ? INBOX_BOOK : subject.kind === 'note' ? subject.book : null;
    return { chip: books.find((book) => book.book === own) ?? null, list: null, query: '' };
}

/** The book whose lists a field's chip offers, if a project it has. */
export function chipProject(state: MoveState): string | null {
    const { chip } = state;
    return chip && chip.book !== INBOX_BOOK ? chip.book : null;
}

/**
 * What the field suggests from: the books without a chip; with a project's chip, its lists (a
 * moved note's own list aside, once they are read); nothing once a list is chosen, or with the
 * Inbox's chip, which has no list to pick.
 */
export type MoveStep =
    | { kind: 'books'; books: readonly MoveBook[] }
    | { kind: 'lists'; lists: readonly NoteList[] }
    | { kind: 'none' };

export function moveStep(
    subject: MoveSubject,
    { chip, list }: Pick<MoveState, 'chip' | 'list'>,
    books: readonly MoveBook[],
    chipNotes: ProjectNotes | undefined,
): MoveStep {
    if (!chip) return { kind: 'books', books };
    if (list || chip.book === INBOX_BOOK || !chipNotes) return { kind: 'none' };
    const own = subject.kind === 'note' && noteHome(subject, chip.book) ? subject.note.list : null;
    return { kind: 'lists', lists: chipNotes.lists.filter((list) => list.id !== own) };
}

/** The names a step's suggestions are ranked by. */
export function stepNames(step: MoveStep): string[] {
    if (step.kind === 'books') return step.books.map((book) => book.name);
    if (step.kind === 'lists') return step.lists.map((list) => list.name);
    return [];
}

/**
 * The suggestions: the step's books or lists, all in their order with nothing typed or until
 * ranked, else as `ranked` orders them (their indices, best first). Among lists, typed text that
 * is not exactly a name (case aside) gets a last row offering to make it, never hidden. No
 * project is made from notes: that is the projects' own flow.
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
    if (step.kind === 'lists' && typed && !names.some((n) => n.toLocaleLowerCase() === exact)) {
        rows.push({ kind: 'newList', name: typed });
    }
    return rows;
}

/** A suggestion taken as a chip: a book replaces the chips, a list follows the book's. */
export function picked(state: MoveState, row: MoveRow): MoveState {
    if (row.kind === 'book') return { chip: row.book, list: null, query: '' };
    return { ...state, list: row, query: '' };
}

/** `Tab`: the suggestion chosen becomes a chip (a note only: a list goes whole); else unchanged. */
export function completed(subject: MoveSubject, state: MoveState, row: MoveRow | null): MoveState {
    return subject.kind === 'list' || !row ? state : picked(state, row);
}

/** Backspace on the empty field takes the last chip away; null when it does nothing. */
export function withoutChip(state: MoveState): MoveState | null {
    if (state.query !== '') return null;
    if (state.list) return { ...state, list: null };
    return state.chip ? { chip: null, list: null, query: '' } : null;
}

/**
 * Text typed into the field. Over a chip that ends the way (a list, the Inbox) it starts the
 * choice again in its place, as Backspace would and then the typing: there is nothing after it
 * to type for.
 */
export function typed(state: MoveState, query: string): MoveState {
    if (state.query === '' && query !== '') {
        if (state.list) return { ...state, list: null, query };
        if (state.chip && !chipProject(state)) return { chip: null, list: null, query };
    }
    return { ...state, query };
}

/**
 * A field left half chosen (the quick note's, on leaving it): with no book chosen it goes back to
 * `before`; a project chosen without a list gets the one it opens on as its chip, once read;
 * nothing typed stays.
 */
export function settled(
    state: MoveState,
    before: MoveState,
    chipNotes: ProjectNotes | undefined,
): MoveState {
    if (!state.chip) return before;
    if (!state.list && chipProject(state) && chipNotes) {
        return { ...state, list: { kind: 'list', list: openListOf(chipNotes) }, query: '' };
    }
    return state.query === '' ? state : { ...state, query: '' };
}

/** A move a field says: where, and what its toast names. */
export interface Move {
    /** The book: `INBOX_BOOK` or a project's id. */
    to: string;
    /** Into which list of `to`; a list moved goes whole and ignores it. */
    list: ListTarget;
    /** The book, or the list when the note stays in its book. */
    name: string;
}

function listTarget(list: ListChoice | null): ListTarget {
    if (!list) return { kind: 'open' };
    return list.kind === 'list'
        ? { kind: 'list', id: list.list.id }
        : { kind: 'new', name: list.name };
}

/**
 * Where a field's chips send the subject: into the list chosen, else the one the book opens on.
 * Null without a book, or where the note is already: a note being written for the Inbox, which
 * it is added to; a note sent into its own project's open list (once the lists are read).
 */
export function moveOf(
    subject: MoveSubject,
    state: MoveState,
    chipNotes: ProjectNotes | undefined,
): Move | null {
    const { chip, list } = state;
    if (!chip || (subject.kind === 'new' && chip.book === INBOX_BOOK)) return null;
    const to = chip.book;
    // within the note's own project the toast names the list, elsewhere the project
    const stays = noteHome(subject, to);
    if (list) return { to, list: listTarget(list), name: stays ? choiceName(list) : chip.name };
    if (!stays) return { to, list: listTarget(null), name: chip.name };
    if (!chipNotes || subject.kind !== 'note') return null;
    const open = openListOf(chipNotes);
    if (subject.note.list === open.id) return null;
    return { to, list: listTarget(null), name: open.name };
}

/** What `↵` does in the Move dialog: a move, the chip completed (the note's own project), or nothing. */
export type Entered = { kind: 'move'; move: Move } | { kind: 'chip'; state: MoveState } | null;

/**
 * What `↵` does in the Move dialog with the row chosen, if any: a move there, a book into the list
 * it opens on, but the note's own project completes into the chip, for another of its lists.
 * Without a row, the move the chips say.
 */
export function entered(
    subject: MoveSubject,
    state: MoveState,
    row: MoveRow | null,
    chipNotes: ProjectNotes | undefined,
): Entered {
    if (row?.kind === 'book' && !state.chip && noteHome(subject, row.book.book)) {
        return { kind: 'chip', state: picked(state, row) };
    }
    const move = moveOf(subject, row ? picked(state, row) : state, chipNotes);
    return move ? { kind: 'move', move } : null;
}
