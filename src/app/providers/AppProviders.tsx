import { QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';

import { type RuntimePorts, tauriRuntimePorts } from '@/infrastructure/platform/runtime';
import { RepositoryProvider } from '@/modules/changes';
import { ProjectsProvider } from '@/modules/projects';
import { createAppQueryClient } from './query-client';
import { useReportUncaughtErrors } from './report-uncaught-errors';
import { TitleBarProvider } from './title-bar';

export function AppProviders({
    children,
    runtime = tauriRuntimePorts,
}: {
    children: ReactNode;
    runtime?: RuntimePorts;
}) {
    const [queryClient] = useState(createAppQueryClient);
    useReportUncaughtErrors(runtime.reportError);

    return (
        <QueryClientProvider client={queryClient}>
            <TitleBarProvider value={runtime.titleBar}>
                <ProjectsProvider value={runtime.projects}>
                    <RepositoryProvider value={runtime.repository}>{children}</RepositoryProvider>
                </ProjectsProvider>
            </TitleBarProvider>
        </QueryClientProvider>
    );
}
