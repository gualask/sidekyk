import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useEffectEvent, useRef } from 'react';
import { useTranslation } from '@/shared/i18n';
import { errorToast, useShowToast } from '@/shared/ui/toasts';
import type { Opened, ProjectList, TilesLayout } from '../model/project.types';
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

/** Shows the list a change returned, when no later change waits behind it (`isLastChange`). */
function showList(queryClient: QueryClient, list: ProjectList) {
    if (isLastChange(queryClient)) queryClient.setQueryData(projectsKey, list);
}

/** A project's name as the list on screen has it, for a message about a change to it. */
function projectName(queryClient: QueryClient, projectId: string): string {
    const list = queryClient.getQueryData<ProjectList>(projectsKey);
    return list?.projects.find((project) => project.id === projectId)?.name ?? projectId;
}

/** The name of the project a folder of the list on screen is of, for a message about it. */
function folderName(queryClient: QueryClient, folderId: string): string {
    const list = queryClient.getQueryData<ProjectList>(projectsKey);
    const project = list?.projects.find((p) => p.folders.some((folder) => folder.id === folderId));
    return project?.name ?? folderId;
}

/** The list, as every reader of it asks for it. */
function projectsQuery(port: ProjectsPort) {
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

/** Names a project anew. A failure is the dialog's to show: it is still open. */
export function useRenameProject() {
    const port = useProjectsPort();
    const queryClient = useQueryClient();
    return useMutation({
        ...projectsChange,
        mutationFn: ({ projectId, name }: { projectId: string; name: string }) =>
            port.renameProject(projectId, name),
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
 * Asks where a moved folder of a project is now, and the project follows it there: `readAgain`
 * reads it at its new place (its id, so its queries, stay). A folder that is another project's is
 * not taken: a toast says whose, with `open` for it. A failure is a toast.
 */
export function useRelocateFolder({
    readAgain,
    open,
}: {
    readAgain: (folderId: string) => void;
    open: (projectId: string) => void;
}) {
    const port = useProjectsPort();
    const queryClient = useQueryClient();
    const showToast = useShowToast();
    const i18n = useTranslation();
    return useMutation({
        ...projectsChange,
        mutationFn: (folderId: string) => port.relocateFolder(folderId),
        onSuccess: (change, folderId) => {
            if (change?.kind === 'inProject') {
                const { id, name } = change;
                showToast({
                    title: i18n.t('projects.folderInProject', { name }),
                    action: { label: i18n.t('common.open'), run: () => open(id) },
                });
                return;
            }
            if (!change) return;
            showList(queryClient, change.list);
            readAgain(folderId);
        },
        onError: (error, folderId) => {
            showToast(
                errorToast(
                    i18n.t('projects.locateFailed', { name: folderName(queryClient, folderId) }),
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
            showList(queryClient, list);
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

/** A folder of a project, by both ids. */
interface FolderOfProject {
    projectId: string;
    folderId: string;
}

/**
 * Tells the backend the folder the window shows (null for none) whenever it changes: it watches
 * that folder, and the palette looks in its files. One at a time, in order, so a quick switch ends
 * on the last folder. A failure is a toast.
 */
export function useFolderOnScreen(folderId: string | null) {
    const port = useProjectsPort();
    const showToast = useShowToast();
    const i18n = useTranslation();
    const told = useRef<Promise<void>>(Promise.resolve());
    const failed = useEffectEvent((error: unknown) =>
        showToast(errorToast(i18n.t('projects.showFolderFailed'), error, i18n)),
    );
    useEffect(() => {
        told.current = told.current.then(() => port.showProjectFolder(folderId)).catch(failed);
    }, [port, folderId]);
}

/**
 * Asks for another folder of a project, which it then follows. A folder that is another
 * project's comes back as `inProject`, for the caller to offer the merge. A failure is the
 * caller's to show.
 */
export function useAddProjectFolder() {
    const port = useProjectsPort();
    const queryClient = useQueryClient();
    return useMutation({
        ...projectsChange,
        mutationFn: (projectId: string) => port.addProjectFolder(projectId),
        onSuccess: (change) => {
            if (change?.kind === 'changed') showList(queryClient, change.list);
        },
    });
}

/**
 * Stops following a folder of a project; the folder and the notes stay. A failure is the
 * caller's to show.
 */
export function useRemoveProjectFolder() {
    const port = useProjectsPort();
    const queryClient = useQueryClient();
    return useMutation({
        ...projectsChange,
        mutationFn: ({ projectId, folderId }: FolderOfProject) =>
            port.removeProjectFolder(projectId, folderId),
        onSuccess: (list) => {
            showList(queryClient, list);
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
