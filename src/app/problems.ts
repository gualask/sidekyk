import { useMemo } from 'react';
import type { ProjectList } from '@/modules/projects';
import { type ProjectFailure, useProjectFailures } from '@/modules/repository';
import { shortcutProblem, useGlobalShortcutStatus } from '@/modules/settings';
import { type Translator, useTranslation } from '@/shared/i18n';
import { MACOS } from '@/shared/platform/macos';
import { type ProjectInfo, projectFolder } from '@/shared/projects/project-info';
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
    const i18n = useTranslation();

    return useMemo(() => {
        const problems = (list?.projects ?? []).flatMap((project) => {
            const failure = failures.get(project.id);
            const problem = failure ? projectProblem(project, failure, fixProject, i18n) : null;
            return problem ? [problem] : [];
        });
        const shortcutIssue = shortcutProblem(shortcut, MACOS, i18n);
        if (shortcutIssue) {
            problems.push({
                id: 'global-shortcut',
                ...shortcutIssue,
                fixes: [{ label: i18n.t('problem.changeShortcut'), run: openSettings }],
            });
        }
        return problems;
    }, [list, failures, fixProject, shortcut, openSettings, i18n]);
}

/** A project's failure as a problem; none for one that tells nothing more than its panels do. */
function projectProblem(
    project: ProjectInfo,
    failure: ProjectFailure,
    fixes: ProjectFixes,
    { t }: Translator,
): Problem | null {
    const id = `${failure}:${project.id}`;
    const locate = { label: t('problem.locate'), run: () => fixes.locate(project) };
    const remove = { label: t('common.remove'), run: () => fixes.remove(project) };
    const retry = { label: t('problem.retry'), run: () => fixes.retry(project) };
    const name = project.name;
    // only a folder can fail to be read
    const folder = projectFolder(project);
    if (!folder) return null;
    if (failure === 'repository_missing') {
        return {
            id,
            title: t('problem.moved.title', { name }),
            detail: t('problem.moved.detail', { place: placeName(folder) }),
            fixes: [locate, remove],
        };
    }
    // the others are a WSL distro's; on this machine, git missing is the panels' to tell
    if (folder.kind !== 'wsl') return null;
    const { distro } = folder;
    if (failure === 'distro_missing') {
        return {
            id,
            title: t('problem.distroMissing.title', { distro }),
            detail: t('problem.distroMissing.detail', { name, distro }),
            fixes: [retry, remove],
        };
    }
    if (failure === 'git_not_found') {
        return {
            id,
            title: t('problem.noGit.title', { distro }),
            detail: t('problem.noGit.detail', { name, distro }),
            fixes: [retry],
        };
    }
    return {
        id,
        title: t('problem.helper.title', { distro }),
        detail: t('problem.helper.detail', { name, distro }),
        fixes: [retry],
    };
}
