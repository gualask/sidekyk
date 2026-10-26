import { convertFileSrc, invoke } from '@tauri-apps/api/core';

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
    getFolderKind: (projectId, start) => invoke('get_folder_kind', { projectId, start }),
    getSnapshot: (projectId) => invoke('get_repository_snapshot', { projectId }),
    getSummary: (projectId) => invoke('get_repository_summary', { projectId }),
    getFileDiff: (projectId, request) => invoke('get_file_diff', { projectId, request }),
    getChangesIgnoringWhitespace: (projectId) =>
        invoke('get_changes_ignoring_whitespace', { projectId }),
    getRecentCommits: (projectId) => invoke('get_recent_commits', { projectId }),
    getCommitActivity: (projectId, since) => invoke('get_commit_activity', { projectId, since }),
    getCommitFiles: (projectId, commit) => invoke('get_commit_files', { projectId, commit }),
    getCommitFileDiff: (projectId, request) =>
        invoke('get_commit_file_diff', { projectId, request }),
    getDirectory: (projectId, path) => invoke('get_directory', { projectId, path }),
    getFileContent: (projectId, path) => invoke('get_file_content', { projectId, path }),
    getFileStamp: (projectId, path) => invoke('get_file_stamp', { projectId, path }),
    // `project_file.rs`: the project and the path encoded whole, the id once before (an older one
    // is a path), the stamp as a query
    projectFileUrl: (projectId, path, { size, modified }) =>
        `${convertFileSrc(`${encodeURIComponent(projectId)}/${path}`, 'project-file')}?v=${modified}-${size}`,
    getMarkdownPreview: (projectId, path) => invoke('get_markdown_preview', { projectId, path }),
    openUrl: (url) => invoke('open_url', { url }),
    getSyntaxColors: (projectId, request) => invoke('get_syntax_colors', { projectId, request }),
    onRepositoryChanged: (listener) =>
        onTauriEvent<RepositoryChangedEvent>(REPOSITORY_CHANGED_EVENT, listener),
    setWindowVisible: (visible) =>
        invoke<string | null>('set_window_visible', { visible }).catch(() => null),
};
