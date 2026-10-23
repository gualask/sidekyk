import { describe, expect, it } from 'vitest';
import type { ProjectInfo } from '@/shared/projects/project-info';
import {
    completed,
    entered,
    initialMove,
    type MoveState,
    type MoveSubject,
    moveBooks,
    moveRows,
    moveStep,
    namesShared,
    withoutChip,
} from './move-dialog';
import { INBOX_BOOK, type Note, type ProjectNotes } from './notes.types';

const projects: ProjectInfo[] = [
    { id: 'casa', name: 'Casa', folders: [] },
    { id: 'shop', name: 'shop', folders: [{ kind: 'local', root: '/dev/shop' }] },
    { id: 'shop2', name: 'Shop', folders: [{ kind: 'wsl', distro: 'Ubuntu', root: '/dev/shop' }] },
];

const note: Note = {
    id: 'n',
    list: 'todo',
    position: 0,
    text: 'buy bulbs',
    created: 0,
    edited: 0,
    done: null,
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

const books = (subject: MoveSubject) => moveBooks(subject, projects, 'Inbox');

describe('the books to move to', () => {
    it('are the projects for an Inbox note, the Inbox first for a project note', () => {
        expect(books(inboxNote).map((b) => b.book)).toEqual(['casa', 'shop', 'shop2']);
        expect(books(casaNote).map((b) => b.book)).toEqual([INBOX_BOOK, 'casa', 'shop', 'shop2']);
    });

    it('are the other projects for a list', () => {
        expect(books(casaList).map((b) => b.book)).toEqual(['shop', 'shop2']);
    });

    it('tell same names apart, case aside', () => {
        const shared = namesShared(books(casaNote));
        expect([...shared].map((b) => b.book)).toEqual(['shop', 'shop2']);
    });
});

describe('the chip', () => {
    it('starts as the own project for a project note, none otherwise', () => {
        expect(initialMove(casaNote, books(casaNote)).chip?.book).toBe('casa');
        expect(initialMove(inboxNote, books(inboxNote)).chip).toBeNull();
        expect(initialMove(casaList, books(casaList)).chip).toBeNull();
    });

    it('comes from Tab on a book, for a note only', () => {
        const all = books(inboxNote);
        const state: MoveState = { chip: null, query: 'ca' };
        const row = { kind: 'book', book: all[0] } as const;
        expect(completed(inboxNote, state, row)).toEqual({ chip: all[0], query: '' });
        expect(completed(casaList, state, row)).toBe(state);
        expect(completed(inboxNote, state, { kind: 'newProject', name: 'ca' })).toBe(state);
    });

    it('goes with Backspace on the empty field only', () => {
        const chip = books(casaNote)[1];
        expect(withoutChip({ chip, query: '' })).toEqual({ chip: null, query: '' });
        expect(withoutChip({ chip, query: 's' })).toBeNull();
        expect(withoutChip({ chip: null, query: '' })).toBeNull();
    });
});

describe('the suggestions', () => {
    it('are every book in order with nothing typed, as ranked once typed', () => {
        const step = moveStep(inboxNote, null, books(inboxNote), undefined);
        expect(moveRows(step, '', [])).toHaveLength(3);
        expect(moveRows(step, 'shop', [2, 1]).map((r) => r.kind === 'book' && r.book.book)).toEqual(
            ['shop2', 'shop'],
        );
    });

    it('end with a new project for a text that is not exactly a name, case aside', () => {
        const step = moveStep(inboxNote, null, books(inboxNote), undefined);
        expect(moveRows(step, 'Csa', []).at(-1)).toEqual({ kind: 'newProject', name: 'Csa' });
        expect(moveRows(step, ' casa ', [0]).map((r) => r.kind)).toEqual(['book']);
        // a typo that matches no name still shows what ↵ makes
        expect(moveRows(step, 'zz', [])).toEqual([{ kind: 'newProject', name: 'zz' }]);
    });

    it("are a project's lists with its chip, the note's own list aside", () => {
        const all = books(casaNote);
        const state = initialMove(casaNote, all);
        const step = moveStep(casaNote, state.chip, all, casaNotes);
        expect(moveRows(step, '', [])).toEqual([{ kind: 'list', list: casaNotes.lists[1] }]);
        expect(moveRows(step, 'Pantry', []).at(-1)).toEqual({ kind: 'newList', name: 'Pantry' });
    });

    it('are none with the Inbox as chip: it has no list step', () => {
        const all = books(casaNote);
        const step = moveStep(casaNote, all[0], all, undefined);
        expect(moveRows(step, 'x', [])).toEqual([]);
    });
});

describe('↵', () => {
    const open = { kind: 'open' } as const;

    it('moves into a book chosen, its open list', () => {
        const all = books(inboxNote);
        expect(
            entered(
                inboxNote,
                { chip: null, query: '' },
                { kind: 'book', book: all[1] },
                undefined,
            ),
        ).toEqual({
            kind: 'move',
            move: { to: { kind: 'book', book: 'shop' }, list: open, name: 'shop' },
        });
    });

    it('makes a project for a new name, and moves nowhere without a row', () => {
        const state: MoveState = { chip: null, query: 'Csa' };
        expect(entered(inboxNote, state, { kind: 'newProject', name: 'Csa' }, undefined)).toEqual({
            kind: 'move',
            move: { to: { kind: 'newProject', name: 'Csa' }, list: open, name: 'Csa' },
        });
        expect(entered(inboxNote, state, null, undefined)).toBeNull();
    });

    it("completes the note's own project into the chip", () => {
        const all = books(casaNote);
        const result = entered(
            casaNote,
            { chip: null, query: 'ca' },
            { kind: 'book', book: all[1] },
            casaNotes,
        );
        expect(result).toEqual({ kind: 'chip', state: { chip: all[1], query: '' } });
    });

    it('moves into a list of the chip, or a new one, naming the list within the own project', () => {
        const all = books(casaNote);
        const state = initialMove(casaNote, all);
        const list = casaNotes.lists[1];
        expect(entered(casaNote, state, { kind: 'list', list }, casaNotes)).toEqual({
            kind: 'move',
            move: {
                to: { kind: 'book', book: 'casa' },
                list: { kind: 'list', id: 'spesa' },
                name: 'Spesa',
            },
        });
        const shop = { chip: all[2], query: 'new' };
        expect(entered(casaNote, shop, { kind: 'newList', name: 'new' }, casaNotes)).toEqual({
            kind: 'move',
            move: {
                to: { kind: 'book', book: 'shop' },
                list: { kind: 'new', name: 'new' },
                name: 'shop',
            },
        });
    });

    it("with a chip and nothing chosen, moves into the list it opens on, but the note's own", () => {
        const all = books(casaNote);
        expect(entered(casaNote, { chip: all[0], query: '' }, null, undefined)).toEqual({
            kind: 'move',
            move: { to: { kind: 'book', book: INBOX_BOOK }, list: open, name: 'Inbox' },
        });
        expect(entered(casaNote, initialMove(casaNote, all), null, casaNotes)).toBeNull();
        const elsewhere = { ...casaNotes, openList: 'spesa' };
        expect(entered(casaNote, initialMove(casaNote, all), null, elsewhere)).toEqual({
            kind: 'move',
            move: { to: { kind: 'book', book: 'casa' }, list: open, name: 'Spesa' },
        });
    });

    it('moves a list into a project chosen, or a new one', () => {
        const all = books(casaList);
        expect(
            entered(casaList, { chip: null, query: '' }, { kind: 'book', book: all[0] }, undefined),
        ).toEqual({
            kind: 'move',
            move: { to: { kind: 'book', book: 'shop' }, list: open, name: 'shop' },
        });
    });
});
