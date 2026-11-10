import type { ProjectInfo } from '@/shared/projects/project-info';

/**
 * A project on this machine, stored before ids were made: its id is its root, and its folder's
 * too.
 */
export function localProject(root: string, name: string): ProjectInfo {
    return { id: root, name, folders: [{ id: root, kind: 'local', root }] };
}

/**
 * A project in a WSL distro, stored before ids were made: its id is its location's, and its
 * folder's too.
 */
export function wslProject(distro: string, root: string, name: string): ProjectInfo {
    const id = `wsl:${distro}:${root}`;
    return { id, name, folders: [{ id, kind: 'wsl', distro, root }] };
}
