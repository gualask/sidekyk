import type { ProjectInfo } from '@/shared/projects/project-info';

/** A project on this machine, as the backend lists it: its id is its root. */
export function localProject(root: string, name: string): ProjectInfo {
    return { id: root, name, location: { kind: 'local', root } };
}

/** A project in a WSL distro, its id made as the backend makes it. */
export function wslProject(distro: string, root: string, name: string): ProjectInfo {
    return { id: `wsl:${distro}:${root}`, name, location: { kind: 'wsl', distro, root } };
}
