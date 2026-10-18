import type { ProjectLocation } from './project-info';

/** The machine a project is on when it is not this one, as the user reads it: `WSL: Ubuntu`. */
export function remoteName(location: ProjectLocation): string | null {
    return location.kind === 'wsl' ? `WSL: ${location.distro}` : null;
}

/** A project's name, with its machine when not this one: `shop (WSL: Ubuntu)`. */
export function nameWithPlace(name: string, location: ProjectLocation): string {
    const remote = remoteName(location);
    return remote ? `${name} (${remote})` : name;
}

/** Where a project's folder is, in a sentence: its path, and its machine when not this one. */
export function placeName(location: ProjectLocation): string {
    const remote = remoteName(location);
    return remote ? `${location.root} (${remote})` : location.root;
}
