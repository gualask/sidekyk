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

export interface RepositoryInfo {
    root: string;
    name: string;
}

interface BranchStatus {
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
    /** null for binary files or when the count is unknown. */
    additions: number | null;
    deletions: number | null;
}

/** Everything that differs from HEAD, staged or not, untracked files included. */
interface ChangeTotals {
    files: number;
    additions: number;
    deletions: number;
}

export interface RepositorySnapshot {
    repository: RepositoryInfo;
    branch: BranchStatus;
    files: ChangedFile[];
    totals: ChangeTotals;
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
