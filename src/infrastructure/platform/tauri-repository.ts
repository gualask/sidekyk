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
    getSnapshot: (projectId) => invoke('get_repository_snapshot', { projectId }),
    getSummary: (projectId) => invoke('get_repository_summary', { projectId }),
    getFileDiff: (projectId, request) => invoke('get_file_diff', { projectId, request }),
    getRecentCommits: (projectId) => invoke('get_recent_commits', { projectId }),
    getCommitFiles: (projectId, commit) => invoke('get_commit_files', { projectId, commit }),
    getCommitFileDiff: (projectId, request) =>
        invoke('get_commit_file_diff', { projectId, request }),
    getDirectory: (projectId, path) => invoke('get_directory', { projectId, path }),
    getFileContent: (projectId, path) => invoke('get_file_content', { projectId, path }),
    getSyntaxColors: (projectId, request) => invoke('get_syntax_colors', { projectId, request }),
    onRepositoryChanged: (listener) =>
        onTauriEvent<RepositoryChangedEvent>(REPOSITORY_CHANGED_EVENT, listener),
    setWindowVisible: (visible) =>
        invoke<string | null>('set_window_visible', { visible }).catch(() => null),
};
