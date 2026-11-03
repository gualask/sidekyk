import { describe, expect, it } from 'vitest';
import { folderOnScreen, type ProjectInfo } from './project-info';

const folder = (id: string) => ({ id, kind: 'local' as const, root: `/p/${id}` });
const project = (...ids: string[]): ProjectInfo => ({
    id: 'shop',
    name: 'Shop',
    folders: ids.map(folder),
});

describe('folderOnScreen', () => {
    it('shows the folder picked of the project', () => {
        expect(folderOnScreen(project('api', 'web'), { shop: 'web' })?.id).toBe('web');
    });

    it('shows the one folder of a project without asking', () => {
        expect(folderOnScreen(project('api'), {})?.id).toBe('api');
    });

    it('shows none of several until one is picked, nor a folder the project no longer has', () => {
        expect(folderOnScreen(project('api', 'web'), {})).toBeNull();
        expect(folderOnScreen(project('api', 'web'), { shop: 'gone' })).toBeNull();
        expect(folderOnScreen(project(), {})).toBeNull();
    });
});
