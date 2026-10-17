import { invoke } from '@tauri-apps/api/core';

import {
    REPOSITORY_CHANGED_EVENT,
    type RepositoryChangedEvent,
    type RepositoryPort,
} from '@/modules/repository';
import { onTauriEvent } from './events';

/**
 * Native repository adapter: commands in `src-tauri/src/interfaces/tauri/repository.rs`, and the
 * window's visibility in `window.rs`.
 */
export const tauriRepository: RepositoryPort = {
    getSnapshot: (root) => invoke('get_repository_snapshot', { root }),
    getSummary: (root) => invoke('get_repository_summary', { root }),
    getFileDiff: (root, request) => invoke('get_file_diff', { root, request }),
    getRecentCommits: (root) => invoke('get_recent_commits', { root }),
    getCommitFiles: (root, commit) => invoke('get_commit_files', { root, commit }),
    getCommitFileDiff: (root, request) => invoke('get_commit_file_diff', { root, request }),
    getDirectory: (root, path) => invoke('get_directory', { root, path }),
    getFileContent: (root, path) => invoke('get_file_content', { root, path }),
    onRepositoryChanged: (listener) =>
        onTauriEvent<RepositoryChangedEvent>(REPOSITORY_CHANGED_EVENT, listener),
    setWindowVisible: (visible) =>
        invoke<string | null>('set_window_visible', { visible }).catch(() => null),
};
