import { invoke } from '@tauri-apps/api/core';

import {
    REPOSITORY_CHANGED_EVENT,
    type RepositoryChangedEvent,
    type RepositoryPort,
} from '@/modules/changes';
import { onTauriEvent } from './events';

/** Native repository adapter: commands in `src-tauri/src/interfaces/tauri/repository.rs`. */
export const tauriRepository: RepositoryPort = {
    getActiveRepository: () => invoke('get_active_repository'),
    pickRepository: () => invoke('pick_repository'),
    getSnapshot: () => invoke('get_repository_snapshot'),
    getFileDiff: (request) => invoke('get_file_diff', { request }),
    onRepositoryChanged: (listener) =>
        onTauriEvent<RepositoryChangedEvent>(REPOSITORY_CHANGED_EVENT, listener),
};
