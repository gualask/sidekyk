import { QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useMemo, useState } from 'react';

import { type RuntimePorts, tauriRuntimePorts } from '@/infrastructure/platform/runtime';
import { ChangesSettingsProvider, RepositoryProvider } from '@/modules/changes';
import { ProjectsProvider } from '@/modules/projects';
import { SearchProvider } from '@/modules/search';
import { SettingsProvider, useSettingsWhenRead } from '@/modules/settings';
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
                                <ChangesSettingsBridge>
                                    <SearchProvider value={runtime.search}>
                                        <ToastsHost>{children}</ToastsHost>
                                    </SearchProvider>
                                </ChangesSettingsBridge>
                            </RepositoryProvider>
                        </ProjectsProvider>
                    </SettingsProvider>
                </TitleBarProvider>
            </ShowWindowProvider>
        </QueryClientProvider>
    );
}

/**
 * What the Changes panel takes from the settings, which it cannot import: the view a diff opens
 * in and the copy template, the default until the settings are read.
 * Read at startup alongside the projects, from the backend's memory, so the first diff asks for
 * the right view.
 */
function ChangesSettingsBridge({ children }: { children: ReactNode }) {
    const settings = useSettingsWhenRead();
    const value = useMemo(
        () => ({
            diffView: settings?.diffView ?? null,
            copyTemplate: settings?.copyTemplate ?? DEFAULT_COPY_TEMPLATE,
        }),
        [settings],
    );
    return <ChangesSettingsProvider value={value}>{children}</ChangesSettingsProvider>;
}
