import { QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';

import { type RuntimePorts, tauriRuntimePorts } from '@/infrastructure/platform/runtime';
import { RepositoryProvider } from '@/modules/changes';
import { ProjectsProvider } from '@/modules/projects';
import { SearchProvider } from '@/modules/search';
import { SettingsProvider } from '@/modules/settings';
import { createAppQueryClient } from './query-client';
import { useReportUncaughtErrors } from './report-uncaught-errors';
import { ShowWindowProvider } from './show-window';
import { TitleBarProvider } from './title-bar';
import { ToastsHost } from './toasts';

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
            <ShowWindowProvider value={runtime.showWindow}>
                <TitleBarProvider value={runtime.titleBar}>
                    <SettingsProvider value={runtime.settings}>
                        <ProjectsProvider value={runtime.projects}>
                            <RepositoryProvider value={runtime.repository}>
                                <SearchProvider value={runtime.search}>
                                    <ToastsHost>{children}</ToastsHost>
                                </SearchProvider>
                            </RepositoryProvider>
                        </ProjectsProvider>
                    </SettingsProvider>
                </TitleBarProvider>
            </ShowWindowProvider>
        </QueryClientProvider>
    );
}
