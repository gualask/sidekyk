import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import type { ProjectInfo, ProjectList } from '../model/project.types';
import { useProjectsPort } from './projects.port';

const projectsKey = ['projects'] as const;

/**
 * Changes to the list run one at a time, in the order the user made them: two quick switches end
 * on the second project, in the backend and on screen.
 */
const projectsScope = { id: 'projects' };

export function useProjects() {
    const port = useProjectsPort();
    return useQuery({ queryKey: projectsKey, queryFn: () => port.getProjects() });
}

/** Reads the list again when the backend changed it, such as a folder given on the command line. */
export function useProjectsChangeSubscription() {
    const port = useProjectsPort();
    const queryClient = useQueryClient();
    useEffect(
        () =>
            port.onProjectsChanged(() => {
                void queryClient.invalidateQueries({ queryKey: projectsKey });
            }),
        [port, queryClient],
    );
}

/** The project on screen, from a list the backend keeps consistent. */
export function activeProject(list: ProjectList): ProjectInfo | null {
    return list.projects.find((project) => project.root === list.active) ?? null;
}

export function useAddProject() {
    const port = useProjectsPort();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => port.addProject(),
        scope: projectsScope,
        onSuccess: (list) => {
            if (list) queryClient.setQueryData(projectsKey, list);
        },
    });
}

/**
 * Shows a project at once; the backend catches up (it starts watching the repository). Showing
 * the project already on screen does nothing. A failure puts the list back as the backend has it
 * (the toasts will say why: the switch has already left the screen that asked for it).
 */
export function useActivateProject() {
    const port = useProjectsPort();
    const queryClient = useQueryClient();
    const { mutate } = useMutation({
        mutationFn: (root: string) => port.activateProject(root),
        scope: projectsScope,
        onMutate: async (root) => {
            await queryClient.cancelQueries({ queryKey: projectsKey });
            queryClient.setQueryData<ProjectList>(projectsKey, (list) =>
                list ? { ...list, active: root } : list,
            );
        },
        onSuccess: (list) => queryClient.setQueryData(projectsKey, list),
        onError: () => queryClient.invalidateQueries({ queryKey: projectsKey }),
    });
    return useCallback(
        (root: string) => {
            if (queryClient.getQueryData<ProjectList>(projectsKey)?.active !== root) mutate(root);
        },
        [queryClient, mutate],
    );
}

export function useRemoveProject() {
    const port = useProjectsPort();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (root: string) => port.removeProject(root),
        scope: projectsScope,
        onSuccess: (list) => queryClient.setQueryData(projectsKey, list),
    });
}
