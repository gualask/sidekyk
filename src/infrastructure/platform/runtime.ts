import type { RepositoryPort } from '@/modules/changes';
import { reportFrontendError } from './tauri-diagnostics';
import { tauriRepository } from './tauri-repository';

/** All runtime boundaries composed by the app shell. Each field remains a focused port. */
export type RuntimePorts = {
    repository: RepositoryPort;
    /** Records an uncaught frontend error where problems are investigated (the app's log). */
    reportError: (message: string) => void;
};

export const tauriRuntimePorts: RuntimePorts = {
    repository: tauriRepository,
    reportError: reportFrontendError,
};
