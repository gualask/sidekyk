// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectInfo } from '@/shared/projects/project-info';
import { renderHook } from '@/shared/testing/render-hook';
import { type RepositoryPort, RepositoryProvider } from './repository.port';
import { useFolderKind, useStartFolder } from './repository.queries';

const API: ProjectInfo = {
    id: 'api',
    name: 'api',
    folders: [{ kind: 'wsl', distro: 'Debian', root: '/home/dev/api' }],
};

/** A distro stopped until a read asks to start it, as the backend's `readable_without_starting`. */
function stoppedDistro() {
    let running = false;
    const getFolderKind = vi.fn(async (_projectId: string, start: boolean) => {
        if (start) running = true;
        if (!running) throw { code: 'distro_stopped', message: 'Debian is not running' };
        return 'repository' as const;
    });
    // the one method these hooks call
    const port = { getFolderKind } as unknown as RepositoryPort;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            <RepositoryProvider value={port}>{children}</RepositoryProvider>
        </QueryClientProvider>
    );
    return { getFolderKind, wrapper };
}

describe('a project whose WSL distro is stopped', () => {
    it('is read without starting it, and starts from its Start button only', async () => {
        const { getFolderKind, wrapper } = stoppedDistro();
        const { result } = renderHook(
            () => ({ folder: useFolderKind(API), start: useStartFolder(API.id) }),
            { wrapper },
        );
        await vi.waitFor(() => expect(result.current.folder.stopped).toBe(true));
        expect(getFolderKind).toHaveBeenCalledTimes(1);
        expect(getFolderKind).toHaveBeenLastCalledWith('api', false);

        // as its button does
        act(() => result.current.start.mutate());
        // the button's answer is the kind: its panels replace the Start panel, nothing read again
        await vi.waitFor(() =>
            expect(result.current.folder).toEqual({
                kind: 'repository',
                waiting: false,
                stopped: false,
            }),
        );
        expect(getFolderKind).toHaveBeenCalledTimes(2);
        expect(getFolderKind).toHaveBeenLastCalledWith('api', true);
    });
});
