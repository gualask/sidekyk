import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { errorToast, useShowToast } from '@/shared/ui/toasts';
import type { ProjectList, TilesLayout } from '../model/project.types';
import { useProjectsPort } from './projects.port';

const projectsKey = ['projects'] as const;

/**
 * Changes to the list run one at a time, in the order the user made them: two quick switches end
 * on the second project, in the backend and on screen.
 */
const projectsChange = { mutationKey: projectsKey, scope: { id: 'projects' } };

/**
 * Whether no later change waits behind the one ending now. The list a change returns is shown
 * only then: in quick switches the screen stays on the last project clicked, instead of going
 * back to each earlier one as the backend catches up.
 */
function isLastChange(queryClient: QueryClient): boolean {
    // the change ending now still counts, as its callbacks run before it settles
    return queryClient.isMutating({ mutationKey: projectsKey }) <= 1;
}

/** A project's name as the list on screen has it, for a message about a change to it. */
function projectName(queryClient: QueryClient, root: string): string {
    const list = queryClient.getQueryData<ProjectList>(projectsKey);
    return list?.projects.find((project) => project.root === root)?.name ?? root;
}

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

/**
 * Asks for a folder and adds its repository; `onAdded` follows, unless the user cancelled. A
 * failure is a toast: the folder picker has closed, nothing on screen waits for it.
 */
export function useAddProject(onAdded: () => void) {
    const port = useProjectsPort();
    const queryClient = useQueryClient();
    const showToast = useShowToast();
    return useMutation({
        ...projectsChange,
        mutationFn: () => port.addProject(),
        onSuccess: (list) => {
            if (!list) return;
            if (isLastChange(queryClient)) queryClient.setQueryData(projectsKey, list);
            onAdded();
        },
        onError: (error) => {
            showToast(errorToast('Could not add the repository', error));
        },
    });
}

/**
 * Shows a project at once; the backend catches up (it starts watching the repository). Showing
 * the project already on screen does nothing. A failure puts the list back as the backend has it,
 * and a toast says why: the switch has already left the screen that asked for it.
 */
export function useActivateProject() {
    const port = useProjectsPort();
    const queryClient = useQueryClient();
    const showToast = useShowToast();
    const { mutate } = useMutation({
        ...projectsChange,
        mutationFn: (root: string) => port.activateProject(root),
        onMutate: async (root) => {
            await queryClient.cancelQueries({ queryKey: projectsKey });
            queryClient.setQueryData<ProjectList>(projectsKey, (list) =>
                list ? { ...list, active: root } : list,
            );
        },
        onSuccess: (list) => {
            if (isLastChange(queryClient)) queryClient.setQueryData(projectsKey, list);
        },
        onError: (error, root) => {
            showToast(errorToast(`Could not open ${projectName(queryClient, root)}`, error));
            if (isLastChange(queryClient)) {
                void queryClient.invalidateQueries({ queryKey: projectsKey });
            }
        },
    });
    return useCallback(
        (root: string) => {
            if (queryClient.getQueryData<ProjectList>(projectsKey)?.active !== root) mutate(root);
        },
        [queryClient, mutate],
    );
}

/** Forgets a project; its repository is left as it is. A failure is a toast. */
export function useRemoveProject() {
    const port = useProjectsPort();
    const queryClient = useQueryClient();
    const showToast = useShowToast();
    return useMutation({
        ...projectsChange,
        mutationFn: (root: string) => port.removeProject(root),
        onSuccess: (list) => {
            if (isLastChange(queryClient)) queryClient.setQueryData(projectsKey, list);
        },
        onError: (error, root) => {
            showToast(errorToast(`Could not remove ${projectName(queryClient, root)}`, error));
        },
    });
}

/** A project's tiles until the user changes them. */
const DEFAULT_LAYOUT: TilesLayout = { minimized: [], split: 0.5 };

/**
 * How a project lays out its tiles, and how to change it: shown at once, stored after. A failure
 * is a toast; the layout stays as shown for the session.
 */
export function useProjectLayout(root: string | null) {
    const port = useProjectsPort();
    const queryClient = useQueryClient();
    const showToast = useShowToast();
    const layout = useQuery({
        queryKey: projectsKey,
        queryFn: () => port.getProjects(),
        select: (list) => (root ? list.layouts[root] : undefined) ?? DEFAULT_LAYOUT,
    }).data;
    const { mutate } = useMutation({
        ...projectsChange,
        mutationFn: ({ root, layout }: { root: string; layout: TilesLayout }) =>
            port.setProjectLayout(root, layout),
        onSuccess: (list) => {
            if (isLastChange(queryClient)) queryClient.setQueryData(projectsKey, list);
        },
        onError: (error) => {
            showToast(errorToast('Could not keep the layout', error));
        },
    });
    // shown at once, in the same render: a view transition captures the layout changed
    const change = useCallback(
        (next: (current: TilesLayout) => TilesLayout) => {
            if (!root) return;
            const list = queryClient.getQueryData<ProjectList>(projectsKey);
            if (!list) return;
            const layout = next(list.layouts[root] ?? DEFAULT_LAYOUT);
            queryClient.setQueryData<ProjectList>(projectsKey, {
                ...list,
                layouts: { ...list.layouts, [root]: layout },
            });
            mutate({ root, layout });
        },
        [root, queryClient, mutate],
    );
    return [layout ?? DEFAULT_LAYOUT, change] as const;
}
