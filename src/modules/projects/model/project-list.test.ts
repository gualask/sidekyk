import { describe, expect, it } from 'vitest';
import type { ProjectInfo } from '@/shared/projects/project-info';
import { activeProject, neighbourProject } from './project-list';

const project = (name: string): ProjectInfo => ({
    id: `/p/${name}`,
    name,
    folders: [{ kind: 'local', root: `/p/${name}` }],
});
const list = (active: string | null, ...names: string[]) => ({
    projects: names.map(project),
    active: active ? `/p/${active}` : null,
    layouts: {},
});

describe('activeProject', () => {
    it('is the project whose id is active', () => {
        expect(activeProject(list('b', 'a', 'b'))).toEqual(project('b'));
        expect(activeProject(list(null))).toBeNull();
    });
});

describe('neighbourProject', () => {
    it('steps through the list in its order, going round at either end', () => {
        expect(neighbourProject(list('a', 'a', 'b', 'c'), 1)).toBe('/p/b');
        expect(neighbourProject(list('c', 'a', 'b', 'c'), 1)).toBe('/p/a');
        expect(neighbourProject(list('a', 'a', 'b', 'c'), -1)).toBe('/p/c');
    });

    it('has nowhere to go with fewer than two projects', () => {
        expect(neighbourProject(list('a', 'a'), 1)).toBeNull();
        expect(neighbourProject(list(null), -1)).toBeNull();
    });
});
