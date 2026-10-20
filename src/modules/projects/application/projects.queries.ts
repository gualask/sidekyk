import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { useTranslation } from '@/shared/i18n';
import { errorToast, useShowToast } from '@/shared/ui/toasts';
import type { ProjectList, TilesLayout } from '../model/project.types';
import { type ProjectsPort, useProjectsPort } from './projects.port';

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
function projectName(queryClient: QueryClient, projectId: string): string {
    const list = queryClient.getQueryData<ProjectList>(projectsKey);
    return list?.projects.find((project) => project.id === projectId)?.name ?? projectId;
}

/** The list, as every reader of it asks for it. */
function projectsQuery(port: ProjectsPort) {
    return { queryKey: projectsKey, queryFn: () => port.getProjects() };
}

export function useProjects() {
    return useQuery(projectsQuery(useProjectsPort()));
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
    const i18n = useTranslation();
    return useMutation({
        ...projectsChange,
        mutationFn: () => port.addProject(),
        onSuccess: (list) => {
            if (!list) return;
            if (isLastChange(queryClient)) queryClient.setQueryData(projectsKey, list);
            onAdded();
        },
        onError: (error) => {
            showToast(errorToast(i18n.t('projects.addFailed'), error, i18n));
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
    const i18n = useTranslation();
    const { mutate } = useMutation({
        ...projectsChange,
        mutationFn: (projectId: string) => port.activateProject(projectId),
        onMutate: async (projectId) => {
            await queryClient.cancelQueries({ queryKey: projectsKey });
            queryClient.setQueryData<ProjectList>(projectsKey, (list) =>
                list ? { ...list, active: projectId } : list,
            );
        },
        onSuccess: (list) => {
            if (isLastChange(queryClient)) queryClient.setQueryData(projectsKey, list);
        },
        onError: (error, projectId) => {
            showToast(
                errorToast(
                    i18n.t('projects.openFailed', { name: projectName(queryClient, projectId) }),
                    error,
                    i18n,
                ),
            );
            if (isLastChange(queryClient)) {
                void queryClient.invalidateQueries({ queryKey: projectsKey });
            }
        },
    });
    return useCallback(
        (projectId: string) => {
            if (queryClient.getQueryData<ProjectList>(projectsKey)?.active !== projectId)
                mutate(projectId);
        },
        [queryClient, mutate],
    );
}

/** Forgets a project; its repository is left as it is. A failure is a toast. */
export function useRemoveProject() {
    const port = useProjectsPort();
    const queryClient = useQueryClient();
    const showToast = useShowToast();
    const i18n = useTranslation();
    return useMutation({
        ...projectsChange,
        mutationFn: (projectId: string) => port.removeProject(projectId),
        onSuccess: (list) => {
            if (isLastChange(queryClient)) queryClient.setQueryData(projectsKey, list);
        },
        onError: (error, projectId) => {
            showToast(
                errorToast(
                    i18n.t('projects.removeFailed', { name: projectName(queryClient, projectId) }),
                    error,
                    i18n,
                ),
            );
        },
    });
}

/**
 * Asks where a moved repository is now and puts its project there; `onRelocated` follows, unless
 * the user cancelled. A failure is a toast.
 */
export function useRelocateProject(onRelocated: () => void) {
    const port = useProjectsPort();
    const queryClient = useQueryClient();
    const showToast = useShowToast();
    const i18n = useTranslation();
    return useMutation({
        ...projectsChange,
        mutationFn: (projectId: string) => port.relocateProject(projectId),
        onSuccess: (list) => {
            if (!list) return;
            if (isLastChange(queryClient)) queryClient.setQueryData(projectsKey, list);
            onRelocated();
        },
        onError: (error, projectId) => {
            showToast(
                errorToast(
                    i18n.t('projects.locateFailed', { name: projectName(queryClient, projectId) }),
                    error,
                    i18n,
                ),
            );
        },
    });
}

/** A project's tiles until the user changes them: none minimized, the side column split even. */
export const DEFAULT_TILES_LAYOUT: TilesLayout = { minimized: [], split: 0.5 };

/**
 * How a project lays out its tiles, and how to change it: shown at once, stored after. A failure
 * is a toast; the layout stays as shown for the session.
 */
export function useProjectLayout(projectId: string | null) {
    const port = useProjectsPort();
    const queryClient = useQueryClient();
    const showToast = useShowToast();
    const i18n = useTranslation();
    const layout = useQuery({
        ...projectsQuery(port),
        select: (list) => (projectId ? list.layouts[projectId] : undefined) ?? DEFAULT_TILES_LAYOUT,
    }).data;
    const { mutate } = useMutation({
        ...projectsChange,
        mutationFn: ({ projectId, layout }: { projectId: string; layout: TilesLayout }) =>
            port.setProjectLayout(projectId, layout),
        onSuccess: (list) => {
            if (isLastChange(queryClient)) queryClient.setQueryData(projectsKey, list);
        },
        onError: (error) => {
            showToast(errorToast(i18n.t('projects.layoutFailed'), error, i18n));
        },
    });
    // shown at once, in the same render: a view transition captures the layout changed
    const change = useCallback(
        (next: (current: TilesLayout) => TilesLayout) => {
            if (!projectId) return;
            const list = queryClient.getQueryData<ProjectList>(projectsKey);
            if (!list) return;
            const layout = next(list.layouts[projectId] ?? DEFAULT_TILES_LAYOUT);
            queryClient.setQueryData<ProjectList>(projectsKey, {
                ...list,
                layouts: { ...list.layouts, [projectId]: layout },
            });
            mutate({ projectId, layout });
        },
        [projectId, queryClient, mutate],
    );
    return [layout ?? DEFAULT_TILES_LAYOUT, change] as const;
}
