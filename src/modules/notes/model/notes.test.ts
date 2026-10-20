import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/shared/i18n';
import {
    doneNotes,
    lineCount,
    noteMeta,
    noteTitle,
    openCounts,
    openNotes,
    positionAt,
    withNotes,
    withoutNote,
    withUpdated,
} from './notes';
import type { Note, ProjectNotes } from './notes.types';

const en = createTranslator('en', 'en');

function note(id: string, position: number, extra: Partial<Note> = {}): Note {
    return {
        id,
        list: 'g',
        position,
        text: id,
        created: 0,
        edited: 0,
        done: null,
        ...extra,
    };
}

const NOTES = [
    note('c', 2),
    note('a', 0),
    note('x', 1, { list: 'r' }),
    note('b', 1),
    note('d1', 5, { done: 10 }),
    note('d2', 6, { done: 20 }),
];

describe('notes', () => {
    it('orders open notes by position and done ones by when', () => {
        expect(openNotes(NOTES, 'g').map((n) => n.id)).toEqual(['a', 'b', 'c']);
        expect(doneNotes(NOTES, 'g').map((n) => n.id)).toEqual(['d2', 'd1']);
        expect(openCounts(NOTES)).toEqual(
            new Map([
                ['g', 3],
                ['r', 1],
            ]),
        );
    });

    it('counts lines without the blank ones at the end', () => {
        expect(lineCount('one')).toBe(1);
        expect(lineCount('one\ntwo\n\n')).toBe(2);
    });

    it('says when a note was written or done, and its length past four lines', () => {
        const now = 10 * 3600_000;
        expect(noteMeta(note('a', 0, { edited: now - 1000 }), now, en)).toBe('just now');
        expect(noteMeta(note('a', 0, { edited: now - 3 * 3600_000 }), now, en)).toBe('3h ago');
        expect(
            noteMeta(note('a', 0, { done: now - 120_000, text: '1\n2\n3\n4\n5' }), now, en),
        ).toBe('done 2m ago · 5 lines');
        const it_ = createTranslator('it', 'it');
        expect(noteMeta(note('a', 0, { edited: now - 1000 }), now, it_)).toBe('adesso');
        expect(
            noteMeta(note('a', 0, { done: now - 120_000, text: '1\n2\n3\n4\n5' }), now, it_),
        ).toBe('completata 2 min fa · 5 righe');
    });

    it('updates notes in place, never bringing back one deleted', () => {
        const project: ProjectNotes = {
            lists: [{ id: 'g', name: 'General' }],
            notes: [note('a', 0), note('b', 1)],
            openList: 'g',
        };
        const updated = withUpdated(project, [note('b', -1), note('gone', 5)]);
        expect(updated.notes.map((n) => [n.id, n.position])).toEqual([
            ['a', 0],
            ['b', -1],
        ]);
        const added = withNotes(withoutNote(updated, 'a'), [note('a', 3), note('n', 4)]);
        expect(added.notes.map((n) => [n.id, n.position])).toEqual([
            ['b', -1],
            ['a', 3],
            ['n', 4],
        ]);
    });

    it('names a note by its first line that is not blank', () => {
        expect(noteTitle('\n  Watcher plan \n1. coalesce')).toBe('Watcher plan');
        expect(noteTitle('  \n')).toBe('');
    });

    it('places a note between its new neighbors', () => {
        const open = openNotes(NOTES, 'g');
        expect(positionAt(open, 'c', 0)).toBe(-1);
        expect(positionAt(open, 'c', 1)).toBe(0.5);
        expect(positionAt(open, 'a', 9)).toBe(3);
        expect(positionAt([], 'z', 0)).toBe(0);
    });
});
