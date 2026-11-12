import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useRef } from 'react';
import { useTranslation } from '@/shared/i18n';
import { errorToast, useShowToast } from '@/shared/ui/toasts';
import type { ProjectList } from '../model/project.types';
import { useProjectsPort } from './projects.port';
import { projectsChange, projectsKey, showList } from './projects.queries';

/** The name of the project a folder of the list on screen is of, for a message about it. */
function folderName(queryClient: QueryClient, folderId: string): string {
    const list = queryClient.getQueryData<ProjectList>(projectsKey);
    const project = list?.projects.find((p) => p.folders.some((folder) => folder.id === folderId));
    return project?.name ?? folderId;
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
