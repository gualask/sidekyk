/**
 * Wire contracts with the Rust backend (`src-tauri/src/modules/repository/contracts.rs`).
 * Change both sides together.
 */

import type { ChangeArea } from '@/shared/git/change-area';

export type { ChangeArea };

export type ChangeKind =
    | 'added'
    | 'modified'
    | 'deleted'
    | 'renamed'
    | 'copied'
    | 'type-changed'
    | 'untracked'
    | 'conflicted';

export interface BranchStatus {
    /** Branch name, or null when HEAD is detached. */
    head: string | null;
    /** Abbreviated HEAD commit, or null before the first commit. */
    commit: string | null;
    upstream: string | null;
    ahead: number;
    behind: number;
}

/**
 * One changed path and its line counts, whatever compares it: a summary against HEAD (whatever the
 * path's areas), or a commit against its parent. Also how a row or a header shows any file.
 */
export interface FileChange {
    path: string;
    origPath: string | null;
    kind: ChangeKind;
    /**
     * null for binary files, and for files whose lines were not read: new files past the limits,
     * new files in a summary, files past a cut list.
     */
    additions: number | null;
    deletions: number | null;
    binary: boolean;
}

/** One file in one area. A file with both staged and unstaged edits appears twice. */
export interface ChangedFile extends FileChange {
    area: ChangeArea;
}

/**
 * Everything that differs from HEAD, staged or not. `files` counts every changed path, new files
 * included; the lines are those of tracked files, since a summary does not read new files.
 */
interface ChangeTotals {
    files: number;
    additions: number;
    deletions: number;
}

/** A repository at a glance: its card, its avatar in the rail, the breadcrumb. */
export interface RepositorySummary {
    branch: BranchStatus;
    totals: ChangeTotals;
    /** The first changed paths in git's order, at most three. */
    files: FileChange[];
    /** git listed more changes than are read (10,000, as VS Code): the list and the file count stop there. */
    truncated: boolean;
}

/** Everything the Changes panel shows of a repository, and the summary of the same git output. */
export interface RepositorySnapshot {
    files: ChangedFile[];
    summary: RepositorySummary;
}

export interface FileDiffRequest {
    path: string;
    origPath: string | null;
    area: ChangeArea;
    /** Every line of the file as context, for the whole-file view; otherwise three, as git's. */
    wholeFile: boolean;
}

/** A unified diff exactly as git prints it, of a changed file or of a file of a commit. */
export interface UnifiedDiff {
    text: string;
    /** Larger than 2 MiB: cut at its last whole line. */
    truncated: boolean;
}

/** One commit of the branch on screen, as the recent commits list it. */
export interface Commit {
    /** The full hash. */
    sha: string;
    /** The first parent, null for a root commit. A merge shows what it brought to it, as VS Code does. */
    parent: string | null;
    /** The commit has more than one parent. */
    merge: boolean;
    author: string;
    /** The author date, in seconds since the Unix epoch. */
    time: number;
    subject: string;
}

/**
 * The last commits of the branch on screen, newest first, following first parents: the commits of
 * a branch merged into it are in its merge.
 */
export interface RecentCommits {
    commits: Commit[];
    /** The branch has older commits than those listed. */
    more: boolean;
}

/** A commit, and the parent it is compared with. */
export interface CommitRequest {
    sha: string;
    parent: string | null;
}

/** The files a commit changed, in git's order. */
export interface CommitFiles {
    files: FileChange[];
    /** The commit changed more files than are read (10,000, as a snapshot). */
    truncated: boolean;
}

export interface CommitFileDiffRequest {
    commit: CommitRequest;
    path: string;
    origPath: string | null;
    /** Every line of the file as context, for the whole-file view; otherwise three, as git's. */
    wholeFile: boolean;
}

export const REPOSITORY_CHANGED_EVENT = 'repository-changed';

export interface RepositoryChangedEvent {
    version: 1;
    root: string;
    /** The index, HEAD or refs changed too: only then may the recent commits have. */
    gitDir: boolean;
}
