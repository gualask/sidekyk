import {
    type DeletedList,
    type ListTarget,
    type Note,
    type NoteList,
    openNotes,
    type ProjectNotes,
    positionAt,
} from '@/modules/notes';
import { failure, newId } from './scenario';

/** A book's notes in memory, as the backend's store keeps them: its lists, its notes, the list open. */
export interface Book {
    lists: NoteList[];
    notes: Note[];
    openList: string;
}

/** A book without notes: one list, `General`, open. */
export function emptyBook(): Book {
    const list = { id: newId(), name: 'General' };
    return { lists: [list], notes: [], openList: list.id };
}

/** The book as it is, copied: what the port answers. */
export function snapshot(book: Book): ProjectNotes {
    return {
        lists: book.lists.map((l) => ({ ...l })),
        notes: book.notes.map((n) => ({ ...n })),
        openList: book.openList,
    };
}

/** A note of the book, by id; `note_missing` for any other. */
export function noteOf(book: Book, id: string): Note {
    const found = book.notes.find((n) => n.id === id);
    if (!found) throw failure('note_missing');
    return found;
}

/** A list of the book, by id; `note_list_missing` for any other. */
export function listOf(book: Book, id: string): NoteList {
    const found = book.lists.find((l) => l.id === id);
    if (!found) throw failure('note_list_missing');
    return found;
}

/** A new note at the top of a list of the book, without images. */
export function addedNote(book: Book, list: string, text: string): Note {
    listOf(book, list);
    const now = Date.now();
    const added: Note = {
        id: newId(),
        list,
        position: positionAt(openNotes(book.notes, list), '', 0),
        text,
        created: now,
        edited: now,
        done: null,
        images: [],
    };
    book.notes.push(added);
    return added;
}

/** Puts a note in, in place of the one with its id if any. */
export function replace(book: Book, put: Note) {
    book.notes = [...book.notes.filter((n) => n.id !== put.id), { ...put }];
}

export function takeOut(book: Book, id: string) {
    book.notes = book.notes.filter((n) => n.id !== id);
}

/** Takes a list out; when it was open, the first left opens. */
export function removeList(book: Book, id: string) {
    book.lists = book.lists.filter((l) => l.id !== id);
    if (book.openList === id) book.openList = book.lists[0].id;
}

/** The list a moved note goes to, made when asked for. */
export function targetList(book: Book, target: ListTarget): string {
    if (target.kind === 'open') return book.openList;
    if (target.kind === 'list') return listOf(book, target.id).id;
    const added = { id: newId(), name: target.name.trim() };
    book.lists.push(added);
    return added.id;
}

/** Takes a book's list out with its notes; the last list stays. */
export function takeList(book: Book, id: string): DeletedList {
    const gone = listOf(book, id);
    const index = book.lists.indexOf(gone);
    if (book.lists.length === 1) throw failure('unknown');
    removeList(book, id);
    const notes = book.notes.filter((n) => n.list === id);
    book.notes = book.notes.filter((n) => n.list !== id);
    return { list: gone, index, notes };
}

/** Puts a deleted list back where it was, with its notes, open. */
export function putList(book: Book, deleted: DeletedList) {
    book.lists.splice(Math.min(deleted.index, book.lists.length), 0, { ...deleted.list });
    for (const back of deleted.notes) replace(book, back);
    book.openList = deleted.list.id;
}
