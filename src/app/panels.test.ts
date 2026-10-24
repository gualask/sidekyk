import { describe, expect, it } from 'vitest';
import { notesPanel } from '@/modules/notes';
import { changesPanel, filesPanel, startPanel } from '@/modules/repository';
import { deepestLevel, panelShortcut, projectTiles, tileBeside } from './panels';

describe('projectTiles', () => {
    it('gives a repository every panel, Changes on the left', () => {
        const tiles = projectTiles('repository');
        expect(tiles.panels).toEqual([changesPanel, filesPanel, notesPanel]);
        expect(tiles.main).toBe(changesPanel);
        expect(tiles.side).toEqual([filesPanel, notesPanel]);
        expect(tiles.fullScreen).toEqual(tiles.panels);
        expect(tiles.summaries.map((summary) => summary.id)).toEqual(['changes', 'files', 'notes']);
        expect(deepestLevel(tiles)).toBe(2);
    });

    it('gives a folder without git Files and Notes, Files on the left', () => {
        const tiles = projectTiles('plain');
        expect(tiles.panels).toEqual([filesPanel, notesPanel]);
        expect(tiles.main).toBe(filesPanel);
        expect(tiles.side).toEqual([notesPanel]);
        expect(tiles.fullScreen).toEqual(tiles.panels);
        expect(tiles.summaries.map((summary) => summary.id)).toEqual(['files', 'notes']);
        expect(deepestLevel(tiles)).toBe(2);
    });

    it('gives a project without folder Notes only, with no level 2', () => {
        const tiles = projectTiles(null);
        expect(tiles.panels).toEqual([notesPanel]);
        expect(tiles.main).toBe(notesPanel);
        expect(tiles.side).toEqual([]);
        expect(tiles.fullScreen).toEqual([]);
        expect(tiles.summaries.map((summary) => summary.id)).toEqual(['notes']);
        expect(deepestLevel(tiles)).toBe(1);
    });

    it('puts the Start panel in place of the folder in a stopped distro, Notes beside', () => {
        const tiles = projectTiles('stopped');
        expect(tiles.panels).toEqual([startPanel, notesPanel]);
        expect(tiles.main).toBe(startPanel);
        expect(tiles.side).toEqual([notesPanel]);
        expect(deepestLevel(tiles)).toBe(2);
        // no key opens it: it stands in for the folder's panels
        expect(panelShortcut(startPanel)).toBeNull();
        expect(panelShortcut(notesPanel)).toBe('3');
    });

    it('keeps one value per kind of project', () => {
        expect(projectTiles('plain')).toBe(projectTiles('plain'));
        expect(projectTiles(null)).toBe(projectTiles(null));
    });
});

describe('tileBeside', () => {
    it('skips the tiles minimized', () => {
        const tiles = projectTiles('repository');
        expect(tileBeside(tiles, changesPanel, 1, [])).toBe(filesPanel);
        expect(tileBeside(tiles, changesPanel, 1, ['files'])).toBe(notesPanel);
        expect(tileBeside(tiles, notesPanel, 1, [])).toBeUndefined();
        expect(tileBeside(projectTiles(null), notesPanel, -1, [])).toBeUndefined();
    });
});
