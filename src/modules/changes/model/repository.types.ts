/**
 * Wire contracts with the Rust backend (`src-tauri/src/modules/repository/contracts.rs`).
 * Change both sides together.
 */

export type ChangeArea = 'staged' | 'unstaged' | 'untracked';

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

/** One file in one area. A file with both staged and unstaged edits appears twice. */
export interface ChangedFile {
    path: string;
    origPath: string | null;
    area: ChangeArea;
    kind: ChangeKind;
    /** null for binary files and for files that were not counted. */
    additions: number | null;
    deletions: number | null;
    binary: boolean;
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

/** One changed path against HEAD, whatever its areas. */
interface SummaryFile {
    path: string;
    kind: ChangeKind;
    /** null for binary files and for new files, which a summary does not read. */
    additions: number | null;
    deletions: number | null;
    binary: boolean;
}

/** A repository at a glance: its card, its avatar in the rail, the breadcrumb. */
export interface RepositorySummary {
    branch: BranchStatus;
    totals: ChangeTotals;
    /** The first changed paths in git's order, at most three. */
    files: SummaryFile[];
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
}

/** A unified diff exactly as git prints it. */
export interface FileDiff {
    path: string;
    area: ChangeArea;
    text: string;
    truncated: boolean;
}

export const REPOSITORY_CHANGED_EVENT = 'repository-changed';

export interface RepositoryChangedEvent {
    version: 1;
    root: string;
}
