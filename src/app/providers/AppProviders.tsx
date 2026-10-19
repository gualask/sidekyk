import { QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useMemo, useState } from 'react';

import { type RuntimePorts, tauriRuntimePorts } from '@/infrastructure/platform/runtime';
import { NotesProvider, NotesSettingsProvider } from '@/modules/notes';
import { ProjectsProvider } from '@/modules/projects';
import { RepositoryProvider, RepositorySettingsProvider } from '@/modules/repository';
import { SearchProvider } from '@/modules/search';
import { SettingsProvider, useChangeSettings, useSettingsWhenRead } from '@/modules/settings';
import { DEFAULT_COPY_TEMPLATE } from '@/shared/copy/copy-template';
import type { NoteLines } from '@/shared/notes/note-lines';
import { SidebarWidthsProvider } from '@/shared/ui/sidebar-width';
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
                                    <SidebarWidthsBridge>
                                        <SearchProvider value={runtime.search}>
                                            <NotesProvider value={runtime.notes}>
                                                <NotesSettingsBridge>
                                                    <ToastsHost>{children}</ToastsHost>
                                                </NotesSettingsBridge>
                                            </NotesProvider>
                                        </SearchProvider>
                                    </SidebarWidthsBridge>
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
 * diff opens in, the copy template, the scrollbar's width and how long lines show, the defaults
 * until the settings are read. Read at startup alongside the projects, from the backend's memory,
 * so the first diff asks for the right view.
 */
function RepositorySettingsBridge({ children }: { children: ReactNode }) {
    const settings = useSettingsWhenRead();
    const value = useMemo(
        () => ({
            diffView: settings?.diffView ?? null,
            copyTemplate: settings?.copyTemplate ?? DEFAULT_COPY_TEMPLATE,
            scrollbar: settings?.diffScrollbar ?? 'narrow',
            codeLines: settings?.codeLines ?? 'scroll',
        }),
        [settings],
    );
    return <RepositorySettingsProvider value={value}>{children}</RepositorySettingsProvider>;
}

/** How Notes shows long lines, from the settings, and how it switches them (`⌥Z`). */
function NotesSettingsBridge({ children }: { children: ReactNode }) {
    const lines = useSettingsWhenRead()?.noteLines ?? 'wrap';
    const change = useChangeSettings();
    const value = useMemo(
        () => ({
            lines,
            setLines: (noteLines: NoteLines) => change((settings) => ({ ...settings, noteLines })),
        }),
        [lines, change],
    );
    return <NotesSettingsProvider value={value}>{children}</NotesSettingsProvider>;
}

const NO_WIDTHS: Readonly<Record<string, number>> = {};

/**
 * Every panel's sidebar widths, from the settings: the defaults until they are read; a width
 * stored before then is dropped, as the settings it would go into are not known yet. Each change
 * starts from the settings as they are then.
 */
function SidebarWidthsBridge({ children }: { children: ReactNode }) {
    const widths = useSettingsWhenRead()?.sidebarWidths ?? NO_WIDTHS;
    const change = useChangeSettings();
    const value = useMemo(
        () => ({
            widths,
            store: (sidebar: string, width: number | null) =>
                change((settings) => {
                    const sidebarWidths = { ...settings.sidebarWidths };
                    if (width === null) delete sidebarWidths[sidebar];
                    else sidebarWidths[sidebar] = width;
                    return { ...settings, sidebarWidths };
                }),
        }),
        [widths, change],
    );
    return <SidebarWidthsProvider value={value}>{children}</SidebarWidthsProvider>;
}
