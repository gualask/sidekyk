import type { ProjectInfo } from '@/shared/projects/project-info';

/** A project on this machine, stored before ids were made: its id is its root. */
export function localProject(root: string, name: string): ProjectInfo {
    return { id: root, name, folders: [{ kind: 'local', root }] };
}

/** A project in a WSL distro, stored before ids were made: its id is its location's. */
export function wslProject(distro: string, root: string, name: string): ProjectInfo {
    return { id: `wsl:${distro}:${root}`, name, folders: [{ kind: 'wsl', distro, root }] };
}
