import { describe, expect, it } from 'vitest';
import { whereToOpen } from './note-references';

describe('where a file a note names opens', () => {
    it('opens in the folder on screen when it holds the file, whatever others do', () => {
        expect(whereToOpen(['f1'], 'f1')).toEqual({ folderId: null, among: null });
        expect(whereToOpen(['f2', 'f1', 'f3'], 'f1')).toEqual({ folderId: null, among: null });
    });

    it('opens in the only other folder that holds it', () => {
        expect(whereToOpen(['f2'], 'f1')).toEqual({ folderId: 'f2', among: null });
        // no folder on screen with its Files panel (a folder without it, a stopped distro)
        expect(whereToOpen(['f2'], null)).toEqual({ folderId: 'f2', among: null });
    });

    it('asks which, among only the folders that hold it, when several others do', () => {
        expect(whereToOpen(['f2', 'f3'], 'f1')).toEqual({ folderId: null, among: ['f2', 'f3'] });
        expect(whereToOpen(['f2', 'f3'], null)).toEqual({ folderId: null, among: ['f2', 'f3'] });
    });

    it('opens nowhere when no folder holds it (moved, deleted)', () => {
        expect(whereToOpen([], 'f1')).toBeNull();
        expect(whereToOpen([], null)).toBeNull();
    });
});
