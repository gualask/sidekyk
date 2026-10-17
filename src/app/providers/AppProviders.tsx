import { QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useMemo, useState } from 'react';

import { type RuntimePorts, tauriRuntimePorts } from '@/infrastructure/platform/runtime';
import { ProjectsProvider } from '@/modules/projects';
import { RepositoryProvider, RepositorySettingsProvider } from '@/modules/repository';
import { SearchProvider } from '@/modules/search';
import { SettingsProvider, useSettingsWhenRead, useUpdateSettings } from '@/modules/settings';
import { DEFAULT_COPY_TEMPLATE } from '@/shared/copy/copy-template';
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
                                <RepositorySettingsBridge>
                                    <SearchProvider value={runtime.search}>
                                        <ToastsHost>{children}</ToastsHost>
                                    </SearchProvider>
                                </RepositorySettingsBridge>
                            </RepositoryProvider>
                        </ProjectsProvider>
                    </SettingsProvider>
                </TitleBarProvider>
            </ShowWindowProvider>
        </QueryClientProvider>
    );
}

/**
 * What the Changes and Files panels take from the settings, which they cannot import: the view a
 * diff opens in, the copy template and the tree's width, the defaults until the settings are
 * read. Read at startup alongside the projects, from the backend's memory, so the first diff asks
 * for the right view.
 */
function RepositorySettingsBridge({ children }: { children: ReactNode }) {
    const settings = useSettingsWhenRead();
    const { mutate } = useUpdateSettings();
    const value = useMemo(
        () => ({
            diffView: settings?.diffView ?? null,
            copyTemplate: settings?.copyTemplate ?? DEFAULT_COPY_TEMPLATE,
            filesTreeWidth: settings?.filesTreeWidth ?? null,
            setFilesTreeWidth: (width: number | null) => {
                if (settings && settings.filesTreeWidth !== width) {
                    mutate({ ...settings, filesTreeWidth: width });
                }
            },
        }),
        [settings, mutate],
    );
    return <RepositorySettingsProvider value={value}>{children}</RepositorySettingsProvider>;
}
