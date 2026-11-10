import type { ProjectLocation } from './project-info';

/**
 * The machine a folder is on when it is not this one, by its name: `Ubuntu`. The one place that
 * reads a location's variant: a new kind of machine changes this file.
 */
export function remoteMachine(location: ProjectLocation): string | null {
    return location.kind === 'wsl' ? location.distro : null;
}

/** The machine a project is on when it is not this one, as the user reads it: `WSL: Ubuntu`. */
export function remoteName(location: ProjectLocation): string | null {
    return location.kind === 'wsl' ? `WSL: ${location.distro}` : null;
}

/** Where a project's folder is, in a sentence: its path, and its machine when not this one. */
export function placeName(location: ProjectLocation): string {
    const remote = remoteName(location);
    return remote ? `${location.root} (${remote})` : location.root;
}

/**
 * How a folder is named among its project's folders: the last part of its root (`api` for
 * `/Users/ale/shop/api`).
 */
export function folderName(location: ProjectLocation): string {
    const parts = location.root.split(/[\\/]/).filter((part) => part !== '');
    return parts.at(-1) ?? location.root;
}
