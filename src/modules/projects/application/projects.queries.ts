import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useEffectEvent } from 'react';
import { useTranslation } from '@/shared/i18n';
import type { ProjectAvatar } from '@/shared/projects/project-info';
import { errorToast, useShowToast } from '@/shared/ui/toasts';
import type { Opened, ProjectList } from '../model/project.types';
import { type ProjectsPort, useProjectsPort } from './projects.port';

export const projectsKey = ['projects'] as const;

/**
 * Changes to the list run one at a time, in the order the user made them: two quick switches end
 * on the second project, in the backend and on screen.
 */
export const projectsChange = { mutationKey: projectsKey, scope: { id: 'projects' } };

/**
 * Whether no later change waits behind the one ending now. The list a change returns is shown
 * only then: in quick switches the screen stays on the last project clicked, instead of going
 * back to each earlier one as the backend catches up.
 */
function isLastChange(queryClient: QueryClient): boolean {
    // the change ending now still counts, as its callbacks run before it settles
    return queryClient.isMutating({ mutationKey: projectsKey }) <= 1;
}

/** Shows the list a change returned, when no later change waits behind it (`isLastChange`). */
export function showList(queryClient: QueryClient, list: ProjectList) {
    if (isLastChange(queryClient)) queryClient.setQueryData(projectsKey, list);
}

/** A project's name as the list on screen has it, for a message about a change to it. */
function projectName(queryClient: QueryClient, projectId: string): string {
    const list = queryClient.getQueryData<ProjectList>(projectsKey);
    return list?.projects.find((project) => project.id === projectId)?.name ?? projectId;
}

/** The list, as every reader of it asks for it. */
export function projectsQuery(port: ProjectsPort) {
    return { queryKey: projectsKey, queryFn: () => port.getProjects() };
}

export function useProjects() {
    return useQuery(projectsQuery(useProjectsPort()));
}

/**
 * The list as it is now, not as the last render read it: a request that comes right after the
 * list changed (a folder given at startup, a project relocated) finds its project there before
 * the next render does.
 */
export function useCurrentProjects(): () => ProjectList | undefined {
    const queryClient = useQueryClient();
    return useCallback(() => queryClient.getQueryData<ProjectList>(projectsKey), [queryClient]);
}

/**
 * Reads the list again when the backend changed it, such as a folder given on the command line;
 * what that folder did goes to `onOpened` once the list read has it: the project put on screen,
 * or a folder above repositories to ask about.
 */
export function useProjectsChangeSubscription(onOpened: (opened: Opened) => void) {
    const port = useProjectsPort();
    const queryClient = useQueryClient();
    const opened = useEffectEvent(onOpened);
    useEffect(
        () =>
            port.onProjectsChanged(() => {
                void (async () => {
                    await queryClient.invalidateQueries({ queryKey: projectsKey });
                    const taken = await port.takeOpened();
                    if (taken !== null) opened(taken);
                })();
            }),
        [port, queryClient],
    );
}

/** Asks for a new project's folder, and tells what it is (`FolderChoice`): nothing changes yet. */
export function useChooseProjectFolder() {
    const port = useProjectsPort();
    return useMutation({ mutationFn: () => port.chooseProjectFolder() });
}

/**
 * Adds a project, with the folders chosen or none, and shows it. A failure is the dialog's to
 * show: it is still open.
 */
export function useCreateProject() {
    const port = useProjectsPort();
    const queryClient = useQueryClient();
    return useMutation({
        ...projectsChange,
        mutationFn: ({ name, folders }: { name: string; folders: string[] }) =>
            port.createProject(name, folders),
        onSuccess: (list) => {
            showList(queryClient, list);
        },
    });
}

/** Gives a project a name and an avatar. A failure is the dialog's to show: it is still open. */
export function useEditProject() {
    const port = useProjectsPort();
    const queryClient = useQueryClient();
    return useMutation({
        ...projectsChange,
        mutationFn: ({
            projectId,
            name,
            avatar,
        }: {
            projectId: string;
            name: string;
            avatar: ProjectAvatar;
        }) => port.editProject(projectId, name, avatar),
        onSuccess: (list) => {
            showList(queryClient, list);
        },
    });
}

/**
 * Shows a project at once while the backend catches up. Showing the project already on screen
 * does nothing. A failure puts the list back as the backend has it, unless a later change waits,
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
            showList(queryClient, list);
        },
        onError: (error, projectId) => {
            const name = projectName(queryClient, projectId);
            showToast(errorToast(i18n.t('projects.openFailed', { name }), error, i18n));
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
            showList(queryClient, list);
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
 * Merges the project `from` into `into`: its folders and lists of notes go to `into`, and it goes;
 * `onMerged` follows with both ids, for what kept their notes. A failure is the caller's to show.
 */
export function useMergeProjects(onMerged: (into: string, from: string) => void) {
    const port = useProjectsPort();
    const queryClient = useQueryClient();
    return useMutation({
        ...projectsChange,
        mutationFn: ({ into, from }: { into: string; from: string }) =>
            port.mergeProjects(into, from),
        onSuccess: (list, { into, from }) => {
            showList(queryClient, list);
            onMerged(into, from);
        },
    });
}
