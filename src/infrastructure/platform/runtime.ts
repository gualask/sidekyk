import type { RepositoryPort } from '@/modules/changes';
import { tauriRepository } from './tauri-repository';

/** All runtime boundaries composed by the app shell. Each field remains a focused port. */
export type RuntimePorts = {
    repository: RepositoryPort;
};

export const tauriRuntimePorts: RuntimePorts = {
    repository: tauriRepository,
};
