import { useMemo } from 'react';
import { useMissingRepositories } from '@/modules/changes';
import { type ProjectList, useRemoveProject } from '@/modules/projects';

/** Something that stays wrong until fixed, listed in the top bar with its fix. */
export interface Problem {
    id: string;
    title: string;
    detail: string;
    fix: { label: string; run: () => void };
}

/**
 * What needs the user, from what the app already knows: nothing is read to find problems. Today a
 * repository moved or deleted, which its panels show too; the list reaches it from any project.
 */
export function useProblems(list: ProjectList | undefined): Problem[] {
    const missing = useMissingRepositories();
    const { mutate: remove } = useRemoveProject();

    return useMemo(
        () =>
            (list?.projects ?? [])
                .filter((project) => missing.includes(project.root))
                .map((project) => ({
                    id: `missing:${project.root}`,
                    title: `${project.name} was moved or deleted`,
                    detail: `Nothing is left at ${project.root}. Remove it, then add it again from its new folder.`,
                    fix: { label: 'Remove', run: () => remove(project.root) },
                })),
        [list, missing, remove],
    );
}
