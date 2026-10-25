import { createContext, createElement, type ReactNode, useContext } from 'react';
import type {
    CommitActivity,
    CommitFileDiffRequest,
    CommitFiles,
    CommitRequest,
    Directory,
    FileContent,
    FileDiffRequest,
    FileStamp,
    FolderKind,
    MarkdownDocument,
    RecentCommits,
    RepositoryChangedEvent,
    RepositorySnapshot,
    RepositorySummary,
    SyntaxColors,
    SyntaxRequest,
    UnifiedDiff,
} from '../model/repository.types';

/**
 * The repositories' runtime boundary: the native backend, or a fixture in browser dev mode. A
 * repository is named by its project's id, which must be a project the user added.
 */
export interface RepositoryPort {
    /**
     * Whether a project's folder is a repository or a folder without git: no git runs. `start`
     * starts a stopped WSL distro holding it, as opening the project does; the cards never do.
     */
    getFolderKind(projectId: string, start: boolean): Promise<FolderKind>;
    getSnapshot(projectId: string): Promise<RepositorySnapshot>;
    /** Branch, changed paths and line totals, cheap enough for every project on screen. */
    getSummary(projectId: string): Promise<RepositorySummary>;
    getFileDiff(projectId: string, request: FileDiffRequest): Promise<UnifiedDiff>;
    /** The last commits of the branch on screen; none before the first commit. */
    getRecentCommits(projectId: string): Promise<RecentCommits>;
    /** The lines each commit of the branch on screen changed since `since` (Unix seconds). */
    getCommitActivity(projectId: string, since: number): Promise<CommitActivity>;
    getCommitFiles(projectId: string, commit: CommitRequest): Promise<CommitFiles>;
    getCommitFileDiff(projectId: string, request: CommitFileDiffRequest): Promise<UnifiedDiff>;
    /** What a folder holds, `''` for the root: read from the backend's list, no git. */
    getDirectory(projectId: string, path: string): Promise<Directory>;
    /** A file of the tree, as the Files panel shows it. */
    getFileContent(projectId: string, path: string): Promise<FileContent>;
    /** The size and last change of a file of the tree. */
    getFileStamp(projectId: string, path: string): Promise<FileStamp>;
    /**
     * The URL an image of the tree loads from, read by the WebView itself; it names the file's
     * stamp, so a changed file is another URL.
     */
    projectFileUrl(projectId: string, path: string, stamp: FileStamp): string;
    /**
     * A Markdown file of the tree as its preview shows it, links and images resolved against the
     * tree; null when it is not text (binary, a link, a submodule).
     */
    getMarkdownPreview(projectId: string, path: string): Promise<MarkdownDocument | null>;
    /**
     * A web or mail address a file shown links to, in the system's browser or mail app; the
     * backend refuses any other scheme.
     */
    openUrl(url: string): Promise<void>;
    /** The colors of a block of lines of one version of a file: colored whole once, then kept. */
    getSyntaxColors(projectId: string, request: SyntaxRequest): Promise<SyntaxColors>;
    /** Returns a synchronous disposer. */
    onRepositoryChanged(listener: (event: RepositoryChangedEvent) => void): () => void;
    /**
     * While the window is hidden, changes on disk are not reported. Showing it again answers with
     * the id of the project on screen when it changed meanwhile. Never fails: `null` when unsure.
     */
    setWindowVisible(visible: boolean): Promise<string | null>;
}

const RepositoryPortContext = createContext<RepositoryPort | null>(null);

export function RepositoryProvider({
    value,
    children,
}: {
    value: RepositoryPort;
    children: ReactNode;
}) {
    return createElement(RepositoryPortContext.Provider, { value }, children);
}

export function useRepositoryPort(): RepositoryPort {
    const port = useContext(RepositoryPortContext);
    if (!port) {
        throw new Error('useRepositoryPort must be used within RepositoryProvider');
    }
    return port;
}
