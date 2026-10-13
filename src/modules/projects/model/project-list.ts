import type { ProjectInfo } from '@/shared/projects/project-info';
import type { ProjectList } from './project.types';

/** The project on screen, from a list the backend keeps consistent. */
export function activeProject(list: ProjectList): ProjectInfo | null {
    return list.projects.find((project) => project.root === list.active) ?? null;
}

/**
 * The root of the project `step` places from the one on screen, going round at either end; null
 * when there is no other project.
 */
export function neighbourProject(list: ProjectList, step: 1 | -1): string | null {
    const count = list.projects.length;
    if (count < 2) return null;
    const at = list.projects.findIndex((project) => project.root === list.active);
    return list.projects[(at + step + count) % count].root;
}
