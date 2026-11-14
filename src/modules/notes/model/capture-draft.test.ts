import { describe, expect, it } from 'vitest';
import {
    type CaptureDraft,
    canRemove,
    chipsPlace,
    draftChanged,
    draftCrops,
    draftImages,
    draftText,
    enterAction,
    initialDestination,
    newDraft,
    placeState,
    steppedTo,
    withCrop,
    withHistory,
    withoutCrop,
} from './capture-draft';
import { withStep } from './marks';
import { INBOX_BOOK, type Mark, type Note, type NoteImage } from './notes.types';

const mark = (text: string): Mark => ({ x: 10, y: 10, text, tail: null });
const crop = (id: string) => ({ crop: id, width: 640, height: 400 });

const image = (id: string, marks: Mark[] | null): NoteImage => ({
    id,
    kind: 'png',
    width: 640,
    height: 400,
    bytes: 1000,
    marked: marks ? { source: { id: `${id}-given`, kind: 'png', bytes: 900 }, marks } : null,
});

const note: Note = {
    id: 'n1',
    list: 'l1',
    position: 0,
    text: 'the menu',
    created: 0,
    edited: 0,
    done: null,
    images: [image('i1', [mark('A'), mark('B')])],
};

const marked = (draft: CaptureDraft, index: number, marks: Mark[]) =>
    withHistory(draft, index, (history) => withStep(history, marks));

const toShop: CaptureDraft = newDraft(
    { kind: 'place', place: { book: 'shop', list: null } },
    null,
    crop('c1'),
);

describe('initialDestination', () => {
    it('goes where its entry says, else the last place, else the project on screen, else the Inbox', () => {
        const last = { book: 'docs', list: 'l2' };
        expect(
            initialDestination(
                { kind: 'into', book: 'shop', target: { kind: 'note', id: 'n1' } },
                last,
                'shop',
            ),
        ).toEqual({ kind: 'note', book: 'shop', note: 'n1' });
        expect(
            initialDestination(
                { kind: 'into', book: INBOX_BOOK, target: { kind: 'new', list: 'l0' } },
                last,
                'shop',
            ),
        ).toEqual({ kind: 'place', place: { book: INBOX_BOOK, list: 'l0' } });
        expect(initialDestination({ kind: 'last' }, last, 'shop')).toEqual({
            kind: 'place',
            place: last,
        });
        expect(initialDestination({ kind: 'last' }, null, 'shop')).toEqual({
            kind: 'place',
            place: { book: 'shop', list: null },
        });
        expect(initialDestination({ kind: 'last' }, null, null)).toEqual({
            kind: 'place',
            place: { book: INBOX_BOOK, list: null },
        });
    });
});

describe('a draft', () => {
    it("starts with its crop selected, after a note's images and with its text", () => {
        expect(toShop.images.map((i) => i.kind)).toEqual(['crop']);
        expect(toShop.selected).toBe(0);
        const added = newDraft({ kind: 'note', book: 'shop', note: 'n1' }, note, crop('c1'));
        expect(added.images.map((i) => i.kind)).toEqual(['image', 'crop']);
        expect(added.selected).toBe(1);
        expect(added.text).toBe('the menu');
        expect(added.images[0].history.present).toEqual([mark('A'), mark('B')]);
    });

    it('takes more crops, each selected as it comes, and goes round its images', () => {
        const two = withCrop(toShop, crop('c2'));
        expect(draftCrops(two)).toEqual(['c1', 'c2']);
        expect(two.selected).toBe(1);
        expect(steppedTo(two, 1).selected).toBe(0);
        expect(steppedTo(two, -1).selected).toBe(0);
        expect(steppedTo(steppedTo(two, 1), -1).selected).toBe(1);
    });

    it("lets a crop go, but never a note's own image nor a new note's only crop", () => {
        expect(canRemove(toShop, 0)).toBe(false);
        expect(withoutCrop(toShop, 0)).toBe(toShop);
        const three = withCrop(withCrop(toShop, crop('c2')), crop('c3'));
        // the last one selected and taken out: the one before is
        expect(withoutCrop(three, 2).selected).toBe(1);
        // one before the selected taken out: the selection stays on its image
        const fewer = withoutCrop(three, 0);
        expect(draftCrops(fewer)).toEqual(['c2', 'c3']);
        expect(fewer.selected).toBe(1);
        const added = newDraft({ kind: 'note', book: 'shop', note: 'n1' }, note, crop('c1'));
        expect(canRemove(added, 0)).toBe(false);
        expect(canRemove(added, 1)).toBe(true);
    });
});

describe('what a draft writes', () => {
    it("writes every crop, and a note's images only when their marks changed", () => {
        const added = newDraft({ kind: 'note', book: 'shop', note: 'n1' }, note, crop('c1'));
        expect(draftImages(added)).toEqual([{ kind: 'crop', crop: 'c1', marks: [], drawn: null }]);
        expect(draftText(added)).toBeNull();
        expect(draftChanged(added)).toBe(false);
        const remarked = marked(added, 0, [mark('A')]);
        expect(draftImages(remarked)[0]).toEqual({
            kind: 'image',
            id: 'i1',
            marks: [mark('A')],
            drawn: null,
        });
        expect(draftChanged(remarked)).toBe(true);
        expect(draftText({ ...added, text: 'two menus' })).toBe('two menus');
    });

    it('has changed once marked or written in', () => {
        expect(draftChanged(toShop)).toBe(false);
        expect(draftText(toShop)).toBe('');
        expect(draftChanged(marked(toShop, 0, [mark('A')]))).toBe(true);
        expect(draftChanged({ ...toShop, text: 'off' })).toBe(true);
    });
});

describe('enterAction', () => {
    const keys = (selected: boolean, shift = false, mod = false) => ({ selected, shift, mod });

    it('writes the note, but a selected mark takes its text and ⇧↵ a new line', () => {
        expect(enterAction('image', keys(false))).toBe('write');
        expect(enterAction('image', keys(true))).toBe('markText');
        expect(enterAction('text', keys(false))).toBe('write');
        expect(enterAction('text', keys(false, true))).toBe('newLine');
        expect(enterAction('image', keys(true, false, true))).toBe('writeAndCopy');
        expect(enterAction('text', keys(false, true, true))).toBe('writeAndCopy');
    });
});

describe('the destination field', () => {
    const books = [
        { book: INBOX_BOOK, name: 'Inbox', folder: null },
        { book: 'shop', name: 'shop', folder: null },
    ];
    const lists = [
        { id: 'l1', name: 'General' },
        { id: 'l2', name: 'Bugs' },
    ];

    it('starts on the place, its list once read', () => {
        expect(placeState({ book: 'shop', list: 'l2' }, books, lists)).toEqual({
            chip: books[1],
            list: { kind: 'list', list: lists[1] },
            query: '',
        });
        expect(placeState({ book: 'shop', list: 'l2' }, books, undefined).list).toBeNull();
        expect(placeState({ book: 'gone', list: null }, books, lists).chip).toBeNull();
        expect(placeState({ book: INBOX_BOOK, list: 'l1' }, books, lists)).toEqual({
            chip: books[0],
            list: null,
            query: '',
        });
    });

    it('sends a new note to the chips’ book and list, the open one without', () => {
        expect(chipsPlace({ chip: books[1], list: null, query: '' })).toEqual({
            book: 'shop',
            list: { kind: 'open' },
        });
        expect(
            chipsPlace({ chip: books[1], list: { kind: 'newList', name: 'Later' }, query: '' }),
        ).toEqual({ book: 'shop', list: { kind: 'new', name: 'Later' } });
        expect(chipsPlace({ chip: null, list: null, query: 'sh' })).toBeNull();
    });
});
