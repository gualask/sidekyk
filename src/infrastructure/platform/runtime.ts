import type { RepositoryPort } from '@/modules/changes';
import type { ProjectsPort } from '@/modules/projects';
import type { SearchPort } from '@/modules/search';
import type { SettingsPort } from '@/modules/settings';
import type { TitleBarPort } from '@/shared/platform/title-bar';
import { reportFrontendError } from './tauri-diagnostics';
import { tauriProjects } from './tauri-projects';
import { tauriRepository } from './tauri-repository';
import { tauriSearch } from './tauri-search';
import { tauriSettings } from './tauri-settings';
import { tauriTitleBar } from './tauri-title-bar';

/** All runtime boundaries composed by the app shell. Each field remains a focused port. */
export type RuntimePorts = {
    projects: ProjectsPort;
    repository: RepositoryPort;
    search: SearchPort;
    settings: SettingsPort;
    titleBar: TitleBarPort;
    /** Records an uncaught frontend error where problems are investigated (the app's log). */
    reportError: (message: string) => void;
};

export const tauriRuntimePorts: RuntimePorts = {
    projects: tauriProjects,
    repository: tauriRepository,
    search: tauriSearch,
    settings: tauriSettings,
    titleBar: tauriTitleBar,
    reportError: reportFrontendError,
};
