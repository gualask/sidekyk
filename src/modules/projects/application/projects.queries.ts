import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
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
