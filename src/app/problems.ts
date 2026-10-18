import { useMemo } from 'react';
import type { ProjectList } from '@/modules/projects';
import { type ProjectFailure, useProjectFailures } from '@/modules/repository';
import { shortcutProblem, useGlobalShortcutStatus } from '@/modules/settings';
import { MACOS } from '@/shared/platform/macos';
import type { ProjectInfo } from '@/shared/projects/project-info';
import { placeName } from '@/shared/projects/project-place';

/** Something that stays wrong until fixed, listed in the top bar with its fix. */
export interface Problem {
    id: string;
    title: string;
    detail: string;
    /** What fixes it, the usual first. */
    fixes: { label: string; run: () => void }[];
}

/** What the problems of a project can do to it. */
export interface ProjectFixes {
    locate: (project: ProjectInfo) => void;
    remove: (project: ProjectInfo) => void;
    /** Read it again, once fixed outside Sidekyk. */
    retry: (project: ProjectInfo) => void;
}

/**
 * What needs the user, from what the app already knows: nothing is read to find problems. A
 * repository moved or deleted, a WSL project whose distro is gone, has no git or does not run
 * Sidekyk's helper, which its panels show too, and the list reaches from any project; a global
 * shortcut the system turned down at startup, or that macOS uses too, fixed in the settings.
 */
export function useProblems(
    list: ProjectList | undefined,
    openSettings: () => void,
    fixProject: ProjectFixes,
): Problem[] {
    const failures = useProjectFailures();
    const shortcut = useGlobalShortcutStatus().data;

    return useMemo(() => {
        const problems = (list?.projects ?? []).flatMap((project) => {
            const failure = failures.get(project.id);
            const problem = failure ? projectProblem(project, failure, fixProject) : null;
            return problem ? [problem] : [];
        });
        const shortcutIssue = shortcutProblem(shortcut, MACOS);
        if (shortcutIssue) {
            problems.push({
                id: 'global-shortcut',
                ...shortcutIssue,
                fixes: [{ label: 'Change shortcut', run: openSettings }],
            });
        }
        return problems;
    }, [list, failures, fixProject, shortcut, openSettings]);
}

/** A project's failure as a problem; none for one that tells nothing more than its panels do. */
function projectProblem(
    project: ProjectInfo,
    failure: ProjectFailure,
    fixes: ProjectFixes,
): Problem | null {
    const id = `${failure}:${project.id}`;
    const locate = { label: 'Locate…', run: () => fixes.locate(project) };
    const remove = { label: 'Remove', run: () => fixes.remove(project) };
    const retry = { label: 'Try again', run: () => fixes.retry(project) };
    if (failure === 'repository_missing') {
        return {
            id,
            title: `${project.name} was moved or deleted`,
            detail: `Nothing is left at ${placeName(project.location)}. Locate its new folder: its notes and layout follow. Or remove it.`,
            fixes: [locate, remove],
        };
    }
    // the others are a WSL distro's; on this machine, git missing is the panels' to tell
    if (project.location.kind !== 'wsl') return null;
    const { distro } = project.location;
    if (failure === 'distro_missing') {
        return {
            id,
            title: `${distro} is not installed`,
            detail: `${project.name} is in the WSL distro ${distro}, which is not on this computer anymore. Install it again, or remove the project.`,
            fixes: [remove, retry],
        };
    }
    if (failure === 'git_not_found') {
        return {
            id,
            title: `git is not installed in ${distro}`,
            detail: `Sidekyk reads ${project.name} with the git of ${distro}. Install it there with its package manager (sudo apt install git on Ubuntu and Debian), then try again.`,
            fixes: [retry],
        };
    }
    return {
        id,
        title: `Sidekyk could not start in ${distro}`,
        detail: `${project.name} is read by a small helper Sidekyk puts in ${distro}, which did not start. The details are in Sidekyk's log.`,
        fixes: [retry],
    };
}
