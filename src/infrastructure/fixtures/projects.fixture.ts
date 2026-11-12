import { AVATAR_COLORS } from '@/shared/projects/avatar';
import type { ProjectAvatar, ProjectInfo } from '@/shared/projects/project-info';

/**
 * A project on this machine, stored before ids were made: its id is its root, and its folder's
 * too; its avatar of `color`, its letters the name's.
 */
export function localProject(root: string, name: string, color: number): ProjectInfo {
    return {
        id: root,
        name,
        folders: [{ id: root, kind: 'local', root }],
        avatar: { color, letters: null },
    };
}

/**
 * A project in a WSL distro, stored before ids were made: its id is its location's, and its
 * folder's too; its avatar of `color`, its letters the name's.
 */
export function wslProject(distro: string, root: string, name: string, color: number): ProjectInfo {
    const id = `wsl:${distro}:${root}`;
    return {
        id,
        name,
        folders: [{ id, kind: 'wsl', distro, root }],
        avatar: { color, letters: null },
    };
}

/**
 * A new project's avatar beside `projects`, as `ProjectList::next_color`: the color fewest of them
 * have, the first on a tie.
 */
export function newAvatar(projects: readonly ProjectInfo[]): ProjectAvatar {
    const counts = Array.from({ length: AVATAR_COLORS }, () => 0);
    for (const project of projects) counts[project.avatar.color - 1] += 1;
    return { color: counts.indexOf(Math.min(...counts)) + 1, letters: null };
}
