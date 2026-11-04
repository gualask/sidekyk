import { useMemo } from 'react';
import type { ProjectList } from '@/modules/projects';
import { type FolderFailure, useFolderFailures } from '@/modules/repository';
import { SHORTCUT_ACTIONS, shortcutProblem, useGlobalShortcutStatus } from '@/modules/settings';
import { type Translator, useTranslation } from '@/shared/i18n';
import { MACOS } from '@/shared/platform/macos';
import type { ProjectFolder, ProjectInfo } from '@/shared/projects/project-info';
import { placeName } from '@/shared/projects/project-place';

/** Something that stays wrong until fixed, listed in the top bar with its fix. */
export interface Problem {
    id: string;
    title: string;
    detail: string;
    /** What fixes it, the usual first. */
    fixes: { label: string; run: () => void }[];
}

/** What the problems of a project's folder can do: to the folder, or to its project. */
export interface ProjectFixes {
    locate: (folder: ProjectFolder) => void;
    remove: (project: ProjectInfo) => void;
    /** Read it again, once fixed outside Sidekyk. */
    retry: (folder: ProjectFolder) => void;
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
    const failures = useFolderFailures();
    const shortcuts = useGlobalShortcutStatus().data;
    const i18n = useTranslation();

    return useMemo(() => {
        const problems = (list?.projects ?? []).flatMap((project) =>
            project.folders.flatMap((folder) => {
                const failure = failures.get(folder.id);
                const problem = failure
                    ? folderProblem(project, folder, failure, fixProject, i18n)
                    : null;
                return problem ? [problem] : [];
            }),
        );
        for (const action of SHORTCUT_ACTIONS) {
            const shortcutIssue = shortcutProblem(action, shortcuts, MACOS, i18n);
            if (shortcutIssue) {
                problems.push({
                    id: `${action}-shortcut`,
                    ...shortcutIssue,
                    fixes: [{ label: i18n.t('problem.changeShortcut'), run: openSettings }],
                });
            }
        }
        return problems;
    }, [list, failures, fixProject, shortcuts, openSettings, i18n]);
}

/**
 * A folder's failure as a problem; none for one that tells nothing more than its panels do.
 */
function folderProblem(
    project: ProjectInfo,
    folder: ProjectFolder,
    failure: FolderFailure,
    fixes: ProjectFixes,
    { t }: Translator,
): Problem | null {
    const id = `${failure}:${folder.id}`;
    const locate = { label: t('problem.locate'), run: () => fixes.locate(folder) };
    const remove = { label: t('common.remove'), run: () => fixes.remove(project) };
    const retry = { label: t('problem.retry'), run: () => fixes.retry(folder) };
    const name = project.name;
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
