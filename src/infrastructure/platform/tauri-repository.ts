import { invoke } from '@tauri-apps/api/core';

import {
    REPOSITORY_CHANGED_EVENT,
    type RepositoryChangedEvent,
    type RepositoryPort,
} from '@/modules/changes';
import { onTauriEvent } from './events';

/** Native repository adapter: commands in `src-tauri/src/interfaces/tauri/repository.rs`. */
export const tauriRepository: RepositoryPort = {
    getSnapshot: (root) => invoke('get_repository_snapshot', { root }),
    getFileDiff: (root, request) => invoke('get_file_diff', { root, request }),
    onRepositoryChanged: (listener) =>
        onTauriEvent<RepositoryChangedEvent>(REPOSITORY_CHANGED_EVENT, listener),
};
