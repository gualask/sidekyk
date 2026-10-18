import { createContext, createElement, type ReactNode, useContext } from 'react';
import type {
    CommitFileDiffRequest,
    CommitFiles,
    CommitRequest,
    Directory,
    FileContent,
    FileDiffRequest,
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
 * repository is named by its root, which must be a project the user added.
 */
export interface RepositoryPort {
    getSnapshot(root: string): Promise<RepositorySnapshot>;
    /** Branch, changed paths and line totals, cheap enough for every project on screen. */
    getSummary(root: string): Promise<RepositorySummary>;
    getFileDiff(root: string, request: FileDiffRequest): Promise<UnifiedDiff>;
    /** The last commits of the branch on screen; none before the first commit. */
    getRecentCommits(root: string): Promise<RecentCommits>;
    getCommitFiles(root: string, commit: CommitRequest): Promise<CommitFiles>;
    getCommitFileDiff(root: string, request: CommitFileDiffRequest): Promise<UnifiedDiff>;
    /** What a folder holds, `''` for the root: read from the backend's list, no git. */
    getDirectory(root: string, path: string): Promise<Directory>;
    /** A file of the tree, as the Files panel shows it. */
    getFileContent(root: string, path: string): Promise<FileContent>;
    /** The colors of a block of lines of one version of a file: colored whole once, then kept. */
    getSyntaxColors(root: string, request: SyntaxRequest): Promise<SyntaxColors>;
    /** Returns a synchronous disposer. */
    onRepositoryChanged(listener: (event: RepositoryChangedEvent) => void): () => void;
    /**
     * While the window is hidden, changes on disk are not reported. Showing it again answers with
     * the root of the project on screen when it changed meanwhile. Never fails: `null` when unsure.
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
