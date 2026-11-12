import type { QueryKey, QueryState } from '@tanstack/react-query';
import { changeTouches } from '../../model/changed-paths';
import type { FileSide } from '../../model/diff/sides';
import type {
    CommitFileDiffRequest,
    CommitRequest,
    FileDiffRequest,
} from '../../model/repository.types';

/**
 * Every query of a repository starts with its folder's id, so a change on disk refetches only
 * its own.
 */
export const repositoryKeys = {
    all: ['repository'] as const,
    of: (folderId: string) => [...repositoryKeys.all, folderId] as const,
    kind: (folderId: string) => [...repositoryKeys.of(folderId), 'kind'] as const,
    snapshot: (folderId: string) => [...repositoryKeys.of(folderId), 'snapshot'] as const,
    summary: (folderId: string) => [...repositoryKeys.of(folderId), 'summary'] as const,
    diff: (folderId: string, request: FileDiffRequest) =>
        [
            ...repositoryKeys.of(folderId),
            'diff',
            request.area,
            request.path,
            request.origPath,
            request.wholeFile,
        ] as const,
    commits: (folderId: string) => [...repositoryKeys.of(folderId), 'commits'] as const,
    /**
     * Outside `of`: a change on disk, the window showing again or a project read again leave it
     * alone, since its key names what would change it, HEAD and the first day.
     */
    activity: (folderId: string, head: string, since: number) =>
        ['activity', folderId, head, since] as const,
    /** Outside `of` too: read only when asked, never again by itself (`useFormattingCheck`). */
    formatting: (folderId: string) => ['formatting', folderId] as const,
    directory: (folderId: string, path: string) =>
        [...repositoryKeys.of(folderId), 'directory', path] as const,
    recent: (folderId: string) => [...repositoryKeys.of(folderId), 'recent'] as const,
    file: (folderId: string, path: string) =>
        [...repositoryKeys.of(folderId), 'file', path] as const,
    preview: (folderId: string, path: string) =>
        [...repositoryKeys.of(folderId), 'preview', path] as const,
    stamp: (folderId: string, path: string) =>
        [...repositoryKeys.of(folderId), 'stamp', path] as const,
    /** Outside `of`: a git object never changes, so its size is read once. */
    blob: (folderId: string, blob: string) => ['blob', folderId, blob] as const,
    /** The working tree's, the index's or HEAD's: `[3]` is the version. */
    colors: (folderId: string, { path, version }: FileSide, first: number) =>
        [...repositoryKeys.of(folderId), 'colors', version.kind, path, first] as const,
};

/** Whether a key's value names a path that the working tree's `changed` paths touch. */
function touchesPath(changed: readonly string[] | null, path: unknown): boolean {
    return typeof path === 'string' && changeTouches(changed, path);
}

/**
 * Whether files written in the working tree (`changed`, or any when `null`) may change what a
 * repository query read, from its key as `repositoryKeys` lays it out. They make no commit and
 * change neither the index nor HEAD, so neither the recent commits nor a staged diff; an open
 * file, its colors or its diff only when it is theirs.
 */
export function worktreeChangeTouches(
    queryKey: QueryKey,
    changed: readonly string[] | null,
): boolean {
    const [, , kind, ...rest] = queryKey;
    switch (kind) {
        // a change of kind is told as such
        case 'kind':
        case 'commits':
            return false;
        case 'diff': {
            const [area, path, origPath] = rest;
            return (
                area !== 'staged' && (touchesPath(changed, path) || touchesPath(changed, origPath))
            );
        }
        // a preview's links and images are not read again when only they change: the file is
        case 'file':
        case 'preview':
        case 'stamp':
            return touchesPath(changed, rest[0]);
        case 'colors':
            return rest[0] === 'worktree' && touchesPath(changed, rest[1]);
        default:
            return true;
    }
}

/**
 * What a commit changed never changes: kept apart from the repository's keys, so neither a change
 * on disk nor the window showing again reads it twice.
 */
export const commitKeys = {
    of: (folderId: string, commit: CommitRequest) =>
        ['commit', folderId, commit.sha, commit.parent] as const,
    files: (folderId: string, commit: CommitRequest) =>
        [...commitKeys.of(folderId, commit), 'files'] as const,
    diff: (folderId: string, request: CommitFileDiffRequest) =>
        [
            ...commitKeys.of(folderId, request.commit),
            'diff',
            request.path,
            request.origPath,
            request.wholeFile,
        ] as const,
    colors: (folderId: string, sha: string, path: string, first: number) =>
        ['commit', folderId, sha, 'colors', path, first] as const,
};

/**
 * How old a read may be when the window or level 0 shows again, before it is read once more
 * (decided with its cases in docs/features/overview.md). The project on screen is read at once
 * when its watcher saw a change while the window was hidden.
 */
const READ_AGAIN_AFTER_MS = 30_000;

/**
 * A read that failed is never fresh: what fixed it outside (a WSL distro started from
 * another of its projects, a folder put back) shows the next time.
 */
export function isOld({ state }: { state: QueryState<unknown> }): boolean {
    if (state.status === 'error') return true;
    const readAt = Math.max(state.dataUpdatedAt, state.errorUpdatedAt);
    return Date.now() - readAt > READ_AGAIN_AFTER_MS;
}

/**
 * When a read kept until something says it changed is read again as a component shows it: with
 * `freshOnShow`, only once it is old (`isOld`); otherwise every time.
 */
export function refetchOnShow(
    freshOnShow: boolean,
): true | ((query: { state: QueryState<unknown> }) => 'always' | false) {
    return freshOnShow ? (query) => (isOld(query) ? 'always' : false) : true;
}
