import {
    type QueryCache,
    type QueryKey,
    type QueryState,
    type UseQueryResult,
    useQueries,
    useQuery,
    useQueryClient,
} from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { hasErrorCode } from '@/shared/errors/app-error';
import { type ProjectInfo, projectFolder } from '@/shared/projects/project-info';
import { changeTouches } from '../model/changed-paths';
import { commitRequest } from '../model/commits';
import type { DiffLine } from '../model/diff-parser';
import { foldersToRead } from '../model/file-tree';
import type {
    Commit,
    CommitFileDiffRequest,
    CommitRequest,
    Directory,
    FileDiffRequest,
    FolderKind,
    RepositorySnapshot,
    SyntaxColors,
} from '../model/repository.types';
import {
    blockKey,
    COLOR_BLOCK,
    type ColorBlock,
    type ColorSides,
    type ColorSource,
    type LineSpans,
    lineColors,
} from '../model/syntax';
import { useRepositoryPort } from './repository.port';

/**
 * Every query of a repository starts with its project's id, so a change on disk refetches only
 * its own.
 */
export const repositoryKeys = {
    all: ['repository'] as const,
    of: (projectId: string) => [...repositoryKeys.all, projectId] as const,
    /** Asked by the cards (`start` false) and by the project opened apart: only one starts a distro. */
    kind: (projectId: string, start: boolean) =>
        [...repositoryKeys.of(projectId), 'kind', start] as const,
    snapshot: (projectId: string) => [...repositoryKeys.of(projectId), 'snapshot'] as const,
    summary: (projectId: string) => [...repositoryKeys.of(projectId), 'summary'] as const,
    diff: (projectId: string, request: FileDiffRequest) =>
        [
            ...repositoryKeys.of(projectId),
            'diff',
            request.area,
            request.path,
            request.origPath,
            request.wholeFile,
        ] as const,
    commits: (projectId: string) => [...repositoryKeys.of(projectId), 'commits'] as const,
    /**
     * Outside `of`: a change on disk, the window showing again or a project read again leave it
     * alone, since its key names what would change it, HEAD and the first day.
     */
    activity: (projectId: string, head: string, since: number) =>
        ['activity', projectId, head, since] as const,
    directory: (projectId: string, path: string) =>
        [...repositoryKeys.of(projectId), 'directory', path] as const,
    file: (projectId: string, path: string) =>
        [...repositoryKeys.of(projectId), 'file', path] as const,
    /** The working tree's, the index's or HEAD's: `[3]` is the version. */
    colors: (projectId: string, { path, version }: ColorSource, first: number) =>
        [...repositoryKeys.of(projectId), 'colors', version.kind, path, first] as const,
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
        case 'file':
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
const commitKeys = {
    of: (projectId: string, commit: CommitRequest) =>
        ['commit', projectId, commit.sha, commit.parent] as const,
    files: (projectId: string, commit: CommitRequest) =>
        [...commitKeys.of(projectId, commit), 'files'] as const,
    diff: (projectId: string, request: CommitFileDiffRequest) =>
        [
            ...commitKeys.of(projectId, request.commit),
            'diff',
            request.path,
            request.origPath,
            request.wholeFile,
        ] as const,
    colors: (projectId: string, sha: string, path: string, first: number) =>
        ['commit', projectId, sha, 'colors', path, first] as const,
};

/**
 * How old a read may be when the window or level 0 shows again, before it is read once more
 * (decided with its cases in docs/features/projects.md). The project on screen is read at once
 * when its watcher saw a change while the window was hidden.
 */
const READ_AGAIN_AFTER_MS = 30_000;

/**
 * A read that failed is never fresh: what fixed it outside (a WSL distro started by opening
 * another of its projects, a folder put back) shows the next time.
 */
function isOld({ state }: { state: QueryState<unknown> }): boolean {
    if (state.status === 'error') return true;
    const readAt = Math.max(state.dataUpdatedAt, state.errorUpdatedAt);
    return Date.now() - readAt > READ_AGAIN_AFTER_MS;
}

/**
 * What a project's folder is, for the panels it has: `null` without folder, `waiting` until read.
 * No git runs, so it answers at once. `start` starts a stopped WSL distro (the project opened);
 * the cards never do, and their answer stands in while the project opened reads its own. A kind
 * that cannot be read counts as a repository, as every folder did before: its panels and the
 * problems tell why.
 */
export function useFolderKind(
    project: ProjectInfo | null,
    { start = false, freshOnShow = false } = {},
): { kind: FolderKind | null; waiting: boolean } {
    const port = useRepositoryPort();
    const queryClient = useQueryClient();
    const projectId = project && projectFolder(project) ? project.id : null;
    const query = useQuery({
        queryKey: repositoryKeys.kind(projectId ?? '', start),
        queryFn: () => port.getFolderKind(projectId ?? '', start),
        enabled: projectId !== null,
        staleTime: Number.POSITIVE_INFINITY,
        placeholderData: () =>
            start && projectId
                ? queryClient.getQueryData<FolderKind>(repositoryKeys.kind(projectId, false))
                : undefined,
        refetchOnMount: freshOnShow ? (query) => (isOld(query) ? 'always' : false) : true,
    });
    if (!projectId) return { kind: null, waiting: false };
    if (query.isError) return { kind: 'repository', waiting: false };
    return { kind: query.data ?? null, waiting: query.isPending };
}

/** A repository's snapshot; none read for a folder without git (`repository` false). */
export function useRepositorySnapshot(projectId: string, repository: boolean) {
    const port = useRepositoryPort();
    const queryClient = useQueryClient();
    return useQuery({
        queryKey: repositoryKeys.snapshot(projectId),
        queryFn: async () => {
            const snapshot = await port.getSnapshot(projectId);
            // the same git output, so the breadcrumb needs no call of its own
            queryClient.setQueryData(repositoryKeys.summary(projectId), snapshot.summary);
            return snapshot;
        },
        enabled: repository,
    });
}

/** A project's snapshot as last read, if any, without reading one or watching for the next. */
export function useSnapshotOf(): (projectId: string) => RepositorySnapshot | undefined {
    const queryClient = useQueryClient();
    return (projectId) => queryClient.getQueryData(repositoryKeys.snapshot(projectId));
}

/**
 * A repository at a glance, for every project on screen. `fromSnapshot` says the Changes panel
 * shows it: its snapshot then brings the summary, and the summary is never fetched on its own.
 * `freshOnShow` reads it again each time the component shows, as the cards of all projects do,
 * unless it was read in the last 30 s.
 *
 * A summary is kept until something says it changed: the watcher, for the project on screen; the
 * window coming back, when an agent may have worked on any project meanwhile; or the cards of all
 * projects showing. The other projects are not watched: nothing runs for them while nobody looks.
 */
export function useRepositorySummary(
    projectId: string,
    { fromSnapshot = false, freshOnShow = false } = {},
) {
    const port = useRepositoryPort();
    return useQuery({
        queryKey: repositoryKeys.summary(projectId),
        queryFn: () => port.getSummary(projectId),
        enabled: !fromSnapshot,
        staleTime: Number.POSITIVE_INFINITY,
        refetchOnMount: freshOnShow ? (query) => (isOld(query) ? 'always' : false) : true,
    });
}

export function useFileDiff(projectId: string, request: FileDiffRequest | null) {
    const port = useRepositoryPort();
    return useQuery({
        queryKey: request
            ? repositoryKeys.diff(projectId, request)
            : [...repositoryKeys.of(projectId), 'none'],
        queryFn: () => (request ? port.getFileDiff(projectId, request) : null),
        enabled: request !== null,
    });
}

/** The data of each directory query, kept the same while none changed. */
function directoriesRead(results: readonly UseQueryResult<Directory>[]) {
    return {
        data: results.map((result) => result.data),
        error: results.find((result) => result.isError)?.error ?? null,
    };
}

/**
 * What the open folders of the tree hold, those that show: the root, and each open folder inside
 * an open folder, once that one is read. Each folder is read on its own, so opening one reads only
 * it. The backend keeps the list of files: a change on disk asks again, and only a file added or
 * removed makes it read the list again.
 */
export function useTreeDirectories(projectId: string, open: ReadonlySet<string>) {
    const port = useRepositoryPort();
    const queryClient = useQueryClient();
    // the folders read so far say which open folders show: one read brings the next
    const paths = foldersToRead(open, (path) =>
        queryClient.getQueryData<Directory>(repositoryKeys.directory(projectId, path)),
    );
    const { data, error } = useQueries({
        queries: paths.map((path) => ({
            queryKey: repositoryKeys.directory(projectId, path),
            queryFn: () => port.getDirectory(projectId, path),
        })),
        combine: directoriesRead,
    });
    const key = paths.join('\0');
    const read = useMemo(() => {
        const byPath = new Map(key.split('\0').map((path, index) => [path, data[index]]));
        return (path: string) => byPath.get(path);
    }, [key, data]);
    return { read, error };
}

/** A file of the tree that did not change, as the Files panel shows it. */
export function useFileContent(projectId: string, path: string | null) {
    const port = useRepositoryPort();
    return useQuery({
        queryKey: path
            ? repositoryKeys.file(projectId, path)
            : [...repositoryKeys.of(projectId), 'none'],
        queryFn: () => (path ? port.getFileContent(projectId, path) : null),
        enabled: path !== null,
    });
}

/**
 * The last commits of the branch on screen, read only while `open`: the section is closed until
 * asked for, and costs nothing until then. Once open, a change of HEAD or refs reads it again.
 */
export function useRecentCommits(projectId: string, open: boolean) {
    const port = useRepositoryPort();
    return useQuery({
        queryKey: repositoryKeys.commits(projectId),
        queryFn: () => port.getRecentCommits(projectId),
        enabled: open,
    });
}

/**
 * The lines each commit of the branch on screen changed since `since`, for a project's card: read
 * once for a HEAD and a first day, again only when either moves. None before the first commit.
 */
export function useCommitActivity(projectId: string, head: string | null, since: number) {
    const port = useRepositoryPort();
    return useQuery({
        queryKey: repositoryKeys.activity(projectId, head ?? '', since),
        queryFn: () => port.getCommitActivity(projectId, since),
        enabled: head !== null,
        staleTime: Number.POSITIVE_INFINITY,
    });
}

/** The files a commit changed, read once: a commit never changes. */
export function useCommitFiles(projectId: string, commit: Commit | null) {
    const port = useRepositoryPort();
    const request = commit ? commitRequest(commit) : null;
    return useQuery({
        queryKey: request ? commitKeys.files(projectId, request) : ['commit', projectId, 'none'],
        queryFn: () => (request ? port.getCommitFiles(projectId, request) : null),
        enabled: request !== null,
        staleTime: Number.POSITIVE_INFINITY,
    });
}

export function useCommitFileDiff(projectId: string, request: CommitFileDiffRequest | null) {
    const port = useRepositoryPort();
    return useQuery({
        queryKey: request ? commitKeys.diff(projectId, request) : ['commit', projectId, 'none'],
        queryFn: () => (request ? port.getCommitFileDiff(projectId, request) : null),
        enabled: request !== null,
        staleTime: Number.POSITIVE_INFINITY,
    });
}

/** The viewer's colors: a line's, or none; and whether a version was too large to color. */
export interface ShownColors {
    colorsOf: (line: DiffLine) => LineSpans | undefined;
    tooLarge: boolean;
}

const NO_COLORS: ShownColors = { colorsOf: () => undefined, tooLarge: false };

/**
 * The colors of the blocks of lines on screen, each block read once per version of its file:
 * the working tree's again when a change on disk comes, the index's and HEAD's when git's own
 * files changed, a commit's never. A line takes its colors only while its text is the one colored,
 * so colors read before a change never land on other text while the next read comes.
 */
export function useSyntaxColors(
    projectId: string,
    sides: ColorSides,
    blocks: readonly ColorBlock[],
): ShownColors {
    const port = useRepositoryPort();
    const shown = blocks.flatMap((block) => {
        const source = sides[block.side];
        return source ? [{ ...block, source }] : [];
    });
    return useQueries({
        queries: shown.map(({ source, first }) => ({
            queryKey:
                source.version.kind === 'commit'
                    ? commitKeys.colors(projectId, source.version.sha, source.path, first)
                    : repositoryKeys.colors(projectId, source, first),
            queryFn: () =>
                port.getSyntaxColors(projectId, {
                    path: source.path,
                    version: source.version,
                    first,
                    count: COLOR_BLOCK,
                }),
            staleTime: source.version.kind === 'commit' ? Number.POSITIVE_INFINITY : 0,
        })),
        combine: (results) => {
            const read = new Map<string, SyntaxColors>();
            results.forEach((result, index) => {
                const block = shown[index];
                if (block && result.data) read.set(blockKey(block), result.data);
            });
            if (read.size === 0) return NO_COLORS;
            return {
                colorsOf: (line: DiffLine) => lineColors(read, line),
                tooLarge: [...read.values()].some((colors) => colors.tooLarge),
            };
        },
    });
}

/** The failures of a project's reads that need the user, the weightiest first. */
const PROJECT_FAILURES = [
    'distro_missing',
    'repository_missing',
    'helper_failed',
    'git_not_found',
] as const;
export type ProjectFailure = (typeof PROJECT_FAILURES)[number];

/** Each project's weightiest failure, as `<failure>\u0001<id>` joined by NUL (no id has either). */
function failedProjects(cache: QueryCache): string {
    const failures = new Map<string, ProjectFailure>();
    for (const query of cache.findAll({ queryKey: repositoryKeys.all, type: 'all' })) {
        if (query.state.status !== 'error') continue;
        const failure = PROJECT_FAILURES.find((code) => hasErrorCode(query.state.error, code));
        if (!failure) continue;
        const id = query.queryKey[1] as string;
        const known = failures.get(id);
        if (!known || PROJECT_FAILURES.indexOf(failure) < PROJECT_FAILURES.indexOf(known)) {
            failures.set(id, failure);
        }
    }
    return [...failures]
        .map(([id, failure]) => `${failure}\u0001${id}`)
        .sort((a, b) => a.localeCompare(b))
        .join('\0');
}

/**
 * The projects whose reads failed in a way that needs the user (moved, a WSL distro gone, no git
 * there, the helper not starting), by id, from what was already read of them: nothing is fetched
 * to know it. One that reads well again leaves the map.
 */
export function useProjectFailures(): ReadonlyMap<string, ProjectFailure> {
    const cache = useQueryClient().getQueryCache();
    const failed = useSyncExternalStore(
        // only a read ending or going changes a failure: not a query made, as one is while a
        // component renders
        (onChange) =>
            cache.subscribe(({ type }) => {
                if (type === 'updated' || type === 'removed') onChange();
            }),
        () => failedProjects(cache),
    );
    return useMemo(
        () =>
            new Map(
                (failed ? failed.split('\0') : []).map((entry) => {
                    const [failure, id] = entry.split('\u0001');
                    return [id, failure as ProjectFailure];
                }),
            ),
        [failed],
    );
}

/** Reads again what is shown of a project: after a fix, such as git installed in its distro. */
export function useReadProjectAgain(): (projectId: string) => void {
    const queryClient = useQueryClient();
    return useCallback(
        (projectId: string) => {
            const queryKey = repositoryKeys.of(projectId);
            void queryClient.invalidateQueries({ queryKey });
            // a failed read off screen too: the problem it raised goes once it reads well
            void queryClient.invalidateQueries({
                queryKey,
                predicate: (query) => query.state.status === 'error',
                refetchType: 'all',
            });
        },
        [queryClient],
    );
}

/**
 * Refetches what is shown of a repository whenever the backend reports a change on disk in it. A
 * summary that comes with the snapshot is not fetched: its snapshot refetches and brings it.
 *
 * While the window is minimized, hidden or covered, the backend reports nothing and no git runs.
 * When it shows again, what is on screen is read again if the watcher saw its project change
 * meanwhile, or if it is older than 30 s: the other projects are not watched, and the watcher
 * cannot see everything (a repository on a network drive). Shown again within 30 s with nothing
 * changed, as when switching back and forth with the agent's terminal, nothing runs.
 */
export function useRepositoryChangeSubscription() {
    const port = useRepositoryPort();
    const queryClient = useQueryClient();
    useEffect(
        () =>
            port.onRepositoryChanged(({ projectId, gitDir, paths, kindChanged }) => {
                const queryKey = repositoryKeys.of(projectId);
                // the folder is now the other kind: what was read of it goes, its kind read again
                if (kindChanged) {
                    void queryClient.resetQueries({ queryKey });
                    return;
                }
                void queryClient.invalidateQueries({
                    queryKey,
                    predicate: ({ queryKey }) => gitDir || worktreeChangeTouches(queryKey, paths),
                });
            }),
        [port, queryClient],
    );
    useEffect(() => {
        const report = async () => {
            const visible = !document.hidden;
            const missed = await port.setWindowVisible(visible);
            if (!visible) return;
            void queryClient.refetchQueries(
                {
                    queryKey: repositoryKeys.all,
                    type: 'active',
                    predicate: (query) => query.queryKey[1] === missed || isOld(query),
                },
                // a read already under way started after the window showed
                { cancelRefetch: false },
            );
        };
        // One report at a time, each with the visibility of its moment: when the window flickers,
        // the backend still ends on the last one, never hidden while the window shows.
        let reports = Promise.resolve();
        const onChange = () => {
            reports = reports.then(report);
        };
        // the backend starts with the window visible
        if (document.hidden) onChange();
        document.addEventListener('visibilitychange', onChange);
        return () => document.removeEventListener('visibilitychange', onChange);
    }, [port, queryClient]);
}
