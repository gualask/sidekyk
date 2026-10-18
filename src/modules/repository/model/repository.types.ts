/**
 * Wire contracts with the Rust backend
 * (`src-tauri/crates/core/src/modules/repository/contracts.rs`). Change both sides together.
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

/** A repository at a glance: its card, the breadcrumb. */
export interface RepositorySummary {
    branch: BranchStatus;
    totals: ChangeTotals;
    /** git listed more changes than are read (10,000, as VS Code): the file count stops there. */
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

/** When a commit was made (seconds since the Unix epoch), and the lines it added and removed. */
interface CommittedLines {
    time: number;
    additions: number;
    deletions: number;
}

/**
 * The commits of the branch on screen since a time, newest first, merges left out: how much work
 * went into a project, day by day.
 */
export interface CommitActivity {
    commits: CommittedLines[];
    /** More commits were made since then than are read (500). */
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

/** One entry of a folder in the Files panel's tree. */
export interface TreeEntry {
    /**
     * The name shown: a folder holding only one folder shares its entry with it, so a folder's
     * name may be several (`modules/changes`).
     */
    name: string;
    /** From the root, with `/` between names; for a shared entry, the deepest folder's. */
    path: string;
    folder: boolean;
}

/** What a folder holds, folders first, each in the order of VS Code's explorer. */
export interface Directory {
    entries: TreeEntry[];
    /** Entries past the most a folder lists (10,000). */
    more: number;
    /** The repository has more files than the tree shows (200,000). */
    truncated: boolean;
}

/** A file as the Files panel shows it. */
export type FileContent =
    /** `truncated`: larger than 2 MiB, cut at its last whole line. */
    | { kind: 'text'; text: string; truncated: boolean }
    | { kind: 'binary' }
    /** A symbolic link, not followed: where it points, as git stores it. */
    | { kind: 'link'; target: string }
    /** A folder git lists as one entry: a submodule. */
    | { kind: 'folder' };

/** One version of a file: the two sides of a diff, or the file the Files panel shows. */
export type FileVersion =
    | { kind: 'worktree' }
    | { kind: 'index' }
    | { kind: 'head' }
    /** A commit's parent is a commit too. */
    | { kind: 'commit'; sha: string };

/** The syntax colors of some lines of one version of a file. */
export interface SyntaxRequest {
    path: string;
    version: FileVersion;
    /** The first line asked for, from 1. */
    first: number;
    /** At most 2,048. */
    count: number;
}

/** What a part of a line is, for its color (One Dark, One Light). */
export type SyntaxTone =
    | 'comment'
    | 'string'
    | 'escape'
    | 'literal'
    | 'constant'
    | 'keyword'
    | 'operator'
    | 'function'
    | 'type'
    | 'tag'
    | 'attribute'
    | 'property'
    | 'parameter'
    | 'title'
    | 'link'
    | 'inserted'
    | 'deleted';

/**
 * One line's colors: each colored part's start and end (UTF-16 offsets), in order. `check` hashes
 * the line's text (`lineCheck`): a line is colored only when its own text has the same.
 */
export interface LineColors {
    check: number;
    spans: [start: number, end: number, tone: SyntaxTone][];
}

/**
 * The colors of the lines asked for, fewer past the end of the file; none when the file has no
 * grammar, or is binary, missing or too large.
 */
export interface SyntaxColors {
    /** Larger than 1 MiB: shown without colors. */
    tooLarge: boolean;
    lines: LineColors[];
}

export const REPOSITORY_CHANGED_EVENT = 'repository-changed';

export interface RepositoryChangedEvent {
    /** 2 since it names the project by its id (`projectId`), not its root. */
    version: 2;
    projectId: string;
    /** The index, HEAD or refs changed too: only then may the recent commits have. */
    gitDir: boolean;
}
