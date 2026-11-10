// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
    type Opened,
    type ProjectList,
    type ProjectsPort,
    ProjectsProvider,
    useProjects,
    useProjectsChangeSubscription,
} from '@/modules/projects';
import { renderHook } from '@/shared/testing/render-hook';
import { ToastsProvider } from '@/shared/ui/toasts';
import { useProjectEntry } from './project-entry';

const LIST: ProjectList = {
    projects: [
        {
            id: 'shop',
            name: 'shop',
            folders: [
                { id: 'shop', kind: 'local', root: '/dev/shop' },
                { id: 'web', kind: 'local', root: '/dev/shop-web' },
            ],
        },
    ],
    active: null,
    layouts: {},
};

/**
 * The backend at a start with a folder given on the command line: the list, and what the folder
 * opened, taken once as the listening starts.
 */
function startedWithFolder(opened: Opened) {
    let taken = false;
    // the methods these hooks call
    const port = {
        getProjects: async () => LIST,
        takeOpened: async () => {
            const answer = taken ? null : opened;
            taken = true;
            return answer;
        },
        activateProject: async (projectId: string) => ({ ...LIST, active: projectId }),
        showProjectFolder: async () => undefined,
        onProjectsChanged: (listener: () => void) => {
            queueMicrotask(listener);
            return () => undefined;
        },
    } as unknown as ProjectsPort;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            <ToastsProvider value={() => undefined}>
                <ProjectsProvider value={port}>{children}</ProjectsProvider>
            </ToastsProvider>
        </QueryClientProvider>
    );
    return { wrapper };
}

describe('a folder given on the command line at startup', () => {
    it('enters its project, though the list was not rendered yet', async () => {
        const { wrapper } = startedWithFolder({ kind: 'project', id: 'shop', folderId: 'web' });
        const entered = vi.fn();
        const { result } = renderHook(
            () => {
                const entry = useProjectEntry(useProjects().data, null);
                useProjectsChangeSubscription((opened) => {
                    if (opened.kind === 'project') {
                        entry.enter(opened.id, entered, opened.folderId);
                    }
                });
                return entry;
            },
            { wrapper },
        );
        await vi.waitFor(() => expect(entered).toHaveBeenCalledTimes(1));
        // the folder given, not a picker among the project's two
        expect(result.current.picker).toBeNull();
    });
});
