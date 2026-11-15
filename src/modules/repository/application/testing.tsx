import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { type RepositoryPort, RepositoryProvider } from './repository.port';

/**
 * The providers a repository hook reads, for `renderHook`: a query client of its own, answers not
 * retried, and a port with only the methods the hook calls.
 */
export function repositoryWrapper(methods: Partial<RepositoryPort>) {
    const port = methods as RepositoryPort;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            <RepositoryProvider value={port}>{children}</RepositoryProvider>
        </QueryClientProvider>
    );
}
