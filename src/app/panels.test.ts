import { describe, expect, it } from 'vitest';
import { notesPanel } from '@/modules/notes';
import { changesPanel, filesPanel } from '@/modules/repository';
import type { ProjectInfo } from '@/shared/projects/project-info';
import { deepestLevel, projectTiles, tileBeside } from './panels';

const repository: ProjectInfo = {
    id: 'shop',
    name: 'shop',
    folders: [{ kind: 'local', root: '/Users/dev/shop' }],
};
const topic: ProjectInfo = { id: 'b0000000000000a1', name: 'Thesis', folders: [] };

describe('projectTiles', () => {
    it('gives a repository every panel, Changes on the left', () => {
        const tiles = projectTiles(repository);
        expect(tiles.panels).toEqual([changesPanel, filesPanel, notesPanel]);
        expect(tiles.main).toBe(changesPanel);
        expect(tiles.side).toEqual([filesPanel, notesPanel]);
        expect(tiles.fullScreen).toEqual(tiles.panels);
        expect(tiles.summaries.map((summary) => summary.id)).toEqual(['changes', 'notes']);
        expect(deepestLevel(tiles)).toBe(2);
    });

    it('gives a project without folder Notes only, with no level 2', () => {
        const tiles = projectTiles(topic);
        expect(tiles.panels).toEqual([notesPanel]);
        expect(tiles.main).toBe(notesPanel);
        expect(tiles.side).toEqual([]);
        expect(tiles.fullScreen).toEqual([]);
        expect(tiles.summaries.map((summary) => summary.id)).toEqual(['notes']);
        expect(deepestLevel(tiles)).toBe(1);
    });

    it('keeps one value per kind of project', () => {
        expect(projectTiles({ ...topic, id: 'other' })).toBe(projectTiles(topic));
    });
});

describe('tileBeside', () => {
    it('skips the tiles minimized', () => {
        const tiles = projectTiles(repository);
        expect(tileBeside(tiles, changesPanel, 1, [])).toBe(filesPanel);
        expect(tileBeside(tiles, changesPanel, 1, ['files'])).toBe(notesPanel);
        expect(tileBeside(tiles, notesPanel, 1, [])).toBeUndefined();
        expect(tileBeside(projectTiles(topic), notesPanel, -1, [])).toBeUndefined();
    });
});
