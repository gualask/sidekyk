import { useMemo } from 'react';
import type { ProjectList } from '@/modules/projects';
import { useMissingRepositories } from '@/modules/repository';
import { shortcutProblem, useGlobalShortcutStatus } from '@/modules/settings';
import { MACOS } from '@/shared/platform/macos';
import type { ProjectInfo } from '@/shared/projects/project-info';

/** Something that stays wrong until fixed, listed in the top bar with its fix. */
export interface Problem {
    id: string;
    title: string;
    detail: string;
    fix: { label: string; run: () => void };
}

/**
 * What needs the user, from what the app already knows: nothing is read to find problems. A
 * repository moved or deleted, which its panels show too, and the list reaches from any project;
 * a global shortcut the system turned down at startup, or that macOS uses too, fixed in the
 * settings.
 */
export function useProblems(
    list: ProjectList | undefined,
    openSettings: () => void,
    removeProject: (project: ProjectInfo) => void,
): Problem[] {
    const missing = useMissingRepositories();
    const shortcut = useGlobalShortcutStatus().data;

    return useMemo(() => {
        const problems: Problem[] = (list?.projects ?? [])
            .filter((project) => missing.includes(project.root))
            .map((project) => ({
                id: `missing:${project.root}`,
                title: `${project.name} was moved or deleted`,
                detail: `Nothing is left at ${project.root}. Remove it, then add it again from its new folder.`,
                fix: { label: 'Remove', run: () => removeProject(project) },
            }));
        const shortcutIssue = shortcutProblem(shortcut, MACOS);
        if (shortcutIssue) {
            problems.push({
                id: 'global-shortcut',
                ...shortcutIssue,
                fix: { label: 'Change shortcut', run: openSettings },
            });
        }
        return problems;
    }, [list, missing, removeProject, shortcut, openSettings]);
}
