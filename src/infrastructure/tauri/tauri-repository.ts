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
    getFolderKind: (folderId, start) => invoke('get_folder_kind', { folderId, start }),
    getSnapshot: (folderId) => invoke('get_repository_snapshot', { folderId }),
    getSummary: (folderId) => invoke('get_repository_summary', { folderId }),
    getFileDiff: (folderId, request) => invoke('get_file_diff', { folderId, request }),
    getChangesIgnoringWhitespace: (folderId) =>
        invoke('get_changes_ignoring_whitespace', { folderId }),
    getRecentCommits: (folderId) => invoke('get_recent_commits', { folderId }),
    getCommitActivity: (folderId, since) => invoke('get_commit_activity', { folderId, since }),
    getCommitFiles: (folderId, commit) => invoke('get_commit_files', { folderId, commit }),
    getCommitFileDiff: (folderId, request) => invoke('get_commit_file_diff', { folderId, request }),
    getDirectory: (folderId, path) => invoke('get_directory', { folderId, path }),
    getRecentFiles: (folderId) => invoke('get_recent_files', { folderId }),
    getFileContent: (folderId, path) => invoke('get_file_content', { folderId, path }),
    foldersHolding: (projectId, first, path) =>
        invoke('folders_holding', { projectId, first, path }),
    getFileStamp: (folderId, path) => invoke('get_file_stamp', { folderId, path }),
    getBlobSize: (folderId, blob) => invoke('get_blob_size', { folderId, blob }),
    // `project_file.rs`: the project and the path encoded whole, the id once before (an older one
    // is a path), the stamp or the object as a query
    projectFileUrl: (folderId, path, source) =>
        `${convertFileSrc(`${encodeURIComponent(folderId)}/${path}`, 'project-file')}?${
            source.kind === 'blob'
                ? `blob=${source.blob}`
                : `v=${source.stamp.modified}-${source.stamp.size}`
        }`,
    getMarkdownPreview: (folderId, path) => invoke('get_markdown_preview', { folderId, path }),
    renderDiagram: (request) => invoke('render_diagram', { request }),
    openUrl: (url) => invoke('open_url', { url }),
    getSyntaxColors: (folderId, request) => invoke('get_syntax_colors', { folderId, request }),
    onRepositoryChanged: (listener) =>
        onTauriEvent<RepositoryChangedEvent>(REPOSITORY_CHANGED_EVENT, listener),
    setWindowVisible: (visible) =>
        invoke<string | null>('set_window_visible', { visible }).catch(() => null),
};
