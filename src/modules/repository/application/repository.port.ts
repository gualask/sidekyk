import { createContext, createElement, type ReactNode, useContext } from 'react';
import type {
    ChangesIgnoringWhitespace,
    CommitActivity,
    CommitFileDiffRequest,
    CommitFiles,
    CommitRequest,
    Directory,
    FileContent,
    FileDiffRequest,
    FileStamp,
    FolderKind,
    ImageSource,
    MarkdownDocument,
    RecentCommits,
    RecentFiles,
    RepositoryChangedEvent,
    RepositorySnapshot,
    RepositorySummary,
    SyntaxColors,
    SyntaxRequest,
    UnifiedDiff,
} from '../model/repository.types';

/**
 * The repositories' runtime boundary: the native backend, or a fixture in browser dev mode. A
 * repository is named by its folder's id, which must be a folder of a project the user added.
 */
export interface RepositoryPort {
    /**
     * Whether a folder of a project is a repository or a folder without git: no git runs. `start`
     * starts a stopped WSL distro holding it, as opening the project does; the cards never do.
     */
    getFolderKind(folderId: string, start: boolean): Promise<FolderKind>;
    getSnapshot(folderId: string): Promise<RepositorySnapshot>;
    /** Branch, changed paths and line totals, cheap enough for every project on screen. */
    getSummary(folderId: string): Promise<RepositorySummary>;
    getFileDiff(folderId: string, request: FileDiffRequest): Promise<UnifiedDiff>;
    /** The staged and unstaged changes with whitespace ignored: a diff of each, only when asked. */
    getChangesIgnoringWhitespace(folderId: string): Promise<ChangesIgnoringWhitespace>;
    /** The last commits of the branch on screen; none before the first commit. */
    getRecentCommits(folderId: string): Promise<RecentCommits>;
    /** The lines each commit of the branch on screen changed since `since` (Unix seconds). */
    getCommitActivity(folderId: string, since: number): Promise<CommitActivity>;
    getCommitFiles(folderId: string, commit: CommitRequest): Promise<CommitFiles>;
    getCommitFileDiff(folderId: string, request: CommitFileDiffRequest): Promise<UnifiedDiff>;
    /** What a folder holds, `''` for the root: read from the backend's list, no git. */
    getDirectory(folderId: string, path: string): Promise<Directory>;
    /** The tree's files by their last change on disk, newest first: no git. */
    getRecentFiles(folderId: string): Promise<RecentFiles>;
    /** A file of the tree, as the Files panel shows it. */
    getFileContent(folderId: string, path: string): Promise<FileContent>;
    /**
     * The folders of a project whose tree holds `path`: `first` alone when it does, else the
     * others that do, in the project's order. None for a path moved, deleted or outside the tree;
     * a folder readable only by starting its WSL distro is left out.
     */
    foldersHolding(projectId: string, first: string | null, path: string): Promise<string[]>;
    /** The size and last change of a file of the tree. */
    getFileStamp(folderId: string, path: string): Promise<FileStamp>;
    /** The size of a git object, a side of an image's diff. */
    getBlobSize(folderId: string, blob: string): Promise<number>;
    /**
     * The URL an image loads from, read by the WebView itself: the tree's file at `path`, or a git
     * object with `path`'s type. It names the file's stamp or the object, so other bytes are
     * another URL.
     */
    projectFileUrl(folderId: string, path: string, source: ImageSource): string;
    /**
     * A Markdown file of the tree as its preview shows it, links and images resolved against the
     * tree; null when it is not text (binary, a link, a submodule).
     */
    getMarkdownPreview(folderId: string, path: string): Promise<MarkdownDocument | null>;
    /**
     * A web or mail address a file shown links to, in the system's browser or mail app; the
     * backend refuses any other scheme.
     */
    openUrl(url: string): Promise<void>;
    /** The colors of a block of lines of one version of a file: colored whole once, then kept. */
    getSyntaxColors(folderId: string, request: SyntaxRequest): Promise<SyntaxColors>;
    /** Returns a synchronous disposer. */
    onRepositoryChanged(listener: (event: RepositoryChangedEvent) => void): () => void;
    /**
     * While the window is hidden, changes on disk are not reported. Showing it again answers with
     * the id of the folder on screen when it changed meanwhile. Never fails: `null` when unsure.
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
