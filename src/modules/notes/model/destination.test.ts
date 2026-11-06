import { describe, expect, it } from 'vitest';
import type { ProjectInfo } from '@/shared/projects/project-info';
import {
    completed,
    entered,
    initialMove,
    type MoveState,
    type MoveSubject,
    moveBooks,
    moveOf,
    moveRows,
    moveStep,
    namesShared,
    settled,
    typed,
    withoutChip,
} from './destination';
import { INBOX_BOOK, type Note, type ProjectNotes } from './notes.types';

const projects: ProjectInfo[] = [
    { id: 'casa', name: 'Casa', folders: [] },
    { id: 'shop', name: 'shop', folders: [{ id: 'f1', kind: 'local', root: '/dev/shop' }] },
    {
        id: 'shop2',
        name: 'Shop',
        folders: [{ id: 'f2', kind: 'wsl', distro: 'Ubuntu', root: '/dev/shop' }],
    },
];

const note: Note = {
    id: 'n',
    list: 'todo',
    position: 0,
    text: 'buy bulbs',
    created: 0,
    edited: 0,
    done: null,
    images: [],
};

const casaNotes: ProjectNotes = {
    lists: [
        { id: 'todo', name: 'To do' },
        { id: 'spesa', name: 'Spesa' },
    ],
    notes: [note],
    openList: 'todo',
};

const inboxNote: MoveSubject = { kind: 'note', book: INBOX_BOOK, note };
const casaNote: MoveSubject = { kind: 'note', book: 'casa', note };
const casaList: MoveSubject = { kind: 'list', book: 'casa', list: casaNotes.lists[1] };

const newNote: MoveSubject = { kind: 'new' };

const books = (subject: MoveSubject) => moveBooks(subject, projects, 'Inbox');
/** A book as a suggestion. */
const book = (subject: MoveSubject, index: number) =>
    ({ kind: 'book', book: books(subject)[index] }) as const;
/** A book as a chip. */
const chip = (subject: MoveSubject, index: number) => books(subject)[index];
const empty: MoveState = { chip: null, list: null, query: '' };

describe('the books to send to', () => {
    it('are the projects for an Inbox note, the Inbox first for a project note', () => {
        expect(books(inboxNote).map((b) => b.book)).toEqual(['casa', 'shop', 'shop2']);
        expect(books(casaNote).map((b) => b.book)).toEqual([INBOX_BOOK, 'casa', 'shop', 'shop2']);
    });

    it('are the Inbox and every project for a note being written', () => {
        expect(books(newNote).map((b) => b.book)).toEqual([INBOX_BOOK, 'casa', 'shop', 'shop2']);
    });

    it('are the other projects for a list', () => {
        expect(books(casaList).map((b) => b.book)).toEqual(['shop', 'shop2']);
    });

    it('tell same names apart, case aside', () => {
        const shared = namesShared(books(casaNote));
        expect([...shared].map((b) => b.book)).toEqual(['shop', 'shop2']);
    });
});

describe('the chips', () => {
    it('start as the own project for a project note, the Inbox for a new one, none otherwise', () => {
        expect(initialMove(casaNote, books(casaNote)).chip).toEqual(chip(casaNote, 1));
        expect(initialMove(newNote, books(newNote)).chip).toEqual(chip(newNote, 0));
        expect(initialMove(inboxNote, books(inboxNote)).chip).toBeNull();
        expect(initialMove(casaList, books(casaList)).chip).toBeNull();
    });

    it('come from Tab on a book, then a list, for a note only', () => {
        const state: MoveState = { ...empty, query: 'ca' };
        const casa = chip(inboxNote, 0);
        const row = book(inboxNote, 0);
        expect(completed(inboxNote, state, row)).toEqual({ chip: casa, list: null, query: '' });
        expect(completed(casaList, state, row)).toBe(state);
        const list = { kind: 'list', list: casaNotes.lists[1] } as const;
        const chosen = { chip: casa, list: null, query: 'sp' };
        expect(completed(newNote, chosen, list)).toEqual({ chip: casa, list, query: '' });
        expect(completed(newNote, chosen, null)).toBe(chosen);
    });

    it('go with Backspace on the empty field, the list first', () => {
        const casa = chip(casaNote, 1);
        const list = { kind: 'list', list: casaNotes.lists[1] } as const;
        expect(withoutChip({ chip: casa, list, query: '' })).toEqual({
            chip: casa,
            list: null,
            query: '',
        });
        expect(withoutChip({ chip: casa, list: null, query: '' })).toEqual(empty);
        expect(withoutChip({ chip: casa, list: null, query: 's' })).toBeNull();
        expect(withoutChip(empty)).toBeNull();
    });

    it('that end the way give their place to what is typed over them', () => {
        const casa = chip(newNote, 1);
        const list = { kind: 'list', list: casaNotes.lists[1] } as const;
        expect(typed({ chip: casa, list, query: '' }, 't')).toEqual({
            chip: casa,
            list: null,
            query: 't',
        });
        expect(typed({ chip: chip(newNote, 0), list: null, query: '' }, 's')).toEqual({
            ...empty,
            query: 's',
        });
        // a project's chip leads to its lists: typing chooses one
        expect(typed({ chip: casa, list: null, query: '' }, 't')).toEqual({
            chip: casa,
            list: null,
            query: 't',
        });
    });

    it('left half chosen go back, or take the list a project opens on', () => {
        const before = initialMove(newNote, books(newNote));
        expect(settled({ ...empty, query: 'sh' }, before, undefined)).toBe(before);
        const casa = chip(newNote, 1);
        expect(settled({ chip: casa, list: null, query: 'x' }, before, casaNotes)).toEqual({
            chip: casa,
            list: { kind: 'list', list: casaNotes.lists[0] },
            query: '',
        });
        // not yet read: the list it opens on all the same, without a chip for it
        expect(settled({ chip: casa, list: null, query: '' }, before, undefined)).toEqual({
            chip: casa,
            list: null,
            query: '',
        });
    });
});

describe('the suggestions', () => {
    it('are every book in order with nothing typed, as ranked once typed', () => {
        const step = moveStep(inboxNote, empty, books(inboxNote), undefined);
        expect(moveRows(step, '', [])).toHaveLength(3);
        expect(moveRows(step, 'shop', [2, 1]).map((r) => r.kind === 'book' && r.book.book)).toEqual(
            ['shop2', 'shop'],
        );
    });

    it('offer no project to make, but a list, for a text that is not exactly a name', () => {
        const all = books(newNote);
        const step = moveStep(inboxNote, empty, books(inboxNote), undefined);
        expect(moveRows(step, 'Orto', [])).toEqual([]);
        expect(moveRows(step, ' casa ', [0]).map((r) => r.kind)).toEqual(['book']);
        const casa = { chip: chip(newNote, 1), list: null, query: '' };
        const lists = moveStep(newNote, casa, all, casaNotes);
        // a typo that matches no name still shows what ↵ makes
        expect(moveRows(lists, 'Semi', []).at(-1)).toEqual({ kind: 'newList', name: 'Semi' });
        expect(moveRows(lists, ' spesa ', [1]).map((r) => r.kind)).toEqual(['list']);
    });

    it("are a project's lists with its chip, the note's own list aside", () => {
        const all = books(casaNote);
        const state = initialMove(casaNote, all);
        const step = moveStep(casaNote, state, all, casaNotes);
        expect(moveRows(step, '', [])).toEqual([{ kind: 'list', list: casaNotes.lists[1] }]);
        expect(moveRows(step, 'Pantry', []).at(-1)).toEqual({ kind: 'newList', name: 'Pantry' });
    });

    it('are none with the Inbox as chip, or a list chosen', () => {
        const all = books(casaNote);
        const inbox = { chip: chip(casaNote, 0), list: null, query: 'x' };
        expect(moveRows(moveStep(casaNote, inbox, all, undefined), 'x', [])).toEqual([]);
        const list = { kind: 'list', list: casaNotes.lists[1] } as const;
        const chosen = { chip: chip(casaNote, 1), list, query: '' };
        expect(moveStep(casaNote, chosen, all, casaNotes)).toEqual({ kind: 'none' });
    });
});

describe('where the chips send', () => {
    const open = { kind: 'open' } as const;

    it('a note being written: the list chosen, else the one the book opens on', () => {
        const shop = chip(newNote, 2);
        expect(moveOf(newNote, { chip: shop, list: null, query: '' }, undefined)).toEqual({
            to: 'shop',
            list: open,
            name: 'shop',
        });
        const list = { kind: 'list', list: casaNotes.lists[1] } as const;
        expect(moveOf(newNote, { chip: shop, list, query: '' }, undefined)).toEqual({
            to: 'shop',
            list: { kind: 'list', id: 'spesa' },
            name: 'shop',
        });
        // added to the Inbox, it is there already
        expect(moveOf(newNote, initialMove(newNote, books(newNote)), undefined)).toBeNull();
        expect(moveOf(newNote, empty, undefined)).toBeNull();
    });
});

describe('↵ in the Move dialog', () => {
    const open = { kind: 'open' } as const;

    it('moves into a book chosen, its open list', () => {
        expect(entered(inboxNote, empty, book(inboxNote, 1), undefined)).toEqual({
            kind: 'move',
            move: { to: 'shop', list: open, name: 'shop' },
        });
    });

    it('moves nowhere without a row or a chip', () => {
        expect(entered(inboxNote, { ...empty, query: 'Csa' }, null, undefined)).toBeNull();
    });

    it("completes the note's own project into the chip", () => {
        const result = entered(casaNote, { ...empty, query: 'ca' }, book(casaNote, 1), casaNotes);
        expect(result).toEqual({
            kind: 'chip',
            state: { chip: chip(casaNote, 1), list: null, query: '' },
        });
    });

    it('moves into a list of the chip, or a new one, naming the list within the own project', () => {
        const state = initialMove(casaNote, books(casaNote));
        const list = casaNotes.lists[1];
        expect(entered(casaNote, state, { kind: 'list', list }, casaNotes)).toEqual({
            kind: 'move',
            move: {
                to: 'casa',
                list: { kind: 'list', id: 'spesa' },
                name: 'Spesa',
            },
        });
        const shop = { chip: chip(casaNote, 2), list: null, query: 'new' };
        expect(entered(casaNote, shop, { kind: 'newList', name: 'new' }, casaNotes)).toEqual({
            kind: 'move',
            move: {
                to: 'shop',
                list: { kind: 'new', name: 'new' },
                name: 'shop',
            },
        });
    });

    it("with a chip and nothing chosen, moves into the list it opens on, but the note's own", () => {
        const inbox = { chip: chip(casaNote, 0), list: null, query: '' };
        expect(entered(casaNote, inbox, null, undefined)).toEqual({
            kind: 'move',
            move: { to: INBOX_BOOK, list: open, name: 'Inbox' },
        });
        const own = initialMove(casaNote, books(casaNote));
        expect(entered(casaNote, own, null, casaNotes)).toBeNull();
        const elsewhere = { ...casaNotes, openList: 'spesa' };
        expect(entered(casaNote, own, null, elsewhere)).toEqual({
            kind: 'move',
            move: { to: 'casa', list: open, name: 'Spesa' },
        });
    });

    it('moves a list into a project chosen', () => {
        expect(entered(casaList, empty, book(casaList, 0), undefined)).toEqual({
            kind: 'move',
            move: { to: 'shop', list: open, name: 'shop' },
        });
    });
});
