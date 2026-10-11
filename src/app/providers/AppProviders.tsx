import { QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';

import { type RuntimePorts, tauriRuntimePorts } from '@/infrastructure/platform/runtime';
import { RepositoryProvider } from '@/modules/changes';
import { createAppQueryClient } from './query-client';

export function AppProviders({
    children,
    runtime = tauriRuntimePorts,
}: {
    children: ReactNode;
    runtime?: RuntimePorts;
}) {
    const [queryClient] = useState(createAppQueryClient);

    return (
        <QueryClientProvider client={queryClient}>
            <RepositoryProvider value={runtime.repository}>{children}</RepositoryProvider>
        </QueryClientProvider>
    );
}
