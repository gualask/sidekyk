import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from '@/shared/i18n';
import { errorToast, useShowToast } from '@/shared/ui/toasts';
import type { ProjectList, TilesLayout } from '../model/project.types';
import { useProjectsPort } from './projects.port';
import { projectsChange, projectsKey, projectsQuery, showList } from './projects.queries';

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
