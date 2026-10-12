import type { RepositoryPort } from '@/modules/changes';
import type { ProjectsPort } from '@/modules/projects';
import { reportFrontendError } from './tauri-diagnostics';
import { tauriProjects } from './tauri-projects';
import { tauriRepository } from './tauri-repository';

/** All runtime boundaries composed by the app shell. Each field remains a focused port. */
export type RuntimePorts = {
    projects: ProjectsPort;
    repository: RepositoryPort;
    /** Records an uncaught frontend error where problems are investigated (the app's log). */
    reportError: (message: string) => void;
};

export const tauriRuntimePorts: RuntimePorts = {
    projects: tauriProjects,
    repository: tauriRepository,
    reportError: reportFrontendError,
};
