import { describe, expect, it } from 'vitest';
import { newNoteTarget, notesShownBy, notesTarget } from './targets';

describe('notes targets', () => {
    it('carries a list and a note, and refuses what is not one', () => {
        expect(notesShownBy(notesTarget('l1', 'n1'))).toEqual({
            list: 'l1',
            note: 'n1',
            write: false,
        });
        expect(notesShownBy(notesTarget('l1'))).toEqual({ list: 'l1', note: null, write: false });
        expect(notesShownBy(newNoteTarget())).toEqual({ list: null, note: null, write: true });
        expect(notesShownBy({ key: '{"path":"a.ts"}' })).toBeNull();
        expect(notesShownBy({ key: 'not json' })).toBeNull();
    });
});
