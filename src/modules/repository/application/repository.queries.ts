import {
    type QueryCache,
    type QueryKey,
    type QueryState,
    type UseQueryResult,
    useMutation,
    useQueries,
    useQuery,
    useQueryClient,
} from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { hasErrorCode } from '@/shared/errors/app-error';
import type { ProjectFolder } from '@/shared/projects/project-info';
import { mergedActivity } from '../model/activity';
import { changeTouches } from '../model/changed-paths';
import { commitRequest } from '../model/commits';
import type { DiffLine } from '../model/diff-parser';
import { foldersToRead } from '../model/file-tree';
import { type FormattingTotals, formattingTotals } from '../model/formatting';
import { MAX_IMAGE_BYTES } from '../model/preview';
import type {
    Commit,
    CommitFileDiffRequest,
    CommitRequest,
    Directory,
    FileDiffRequest,
    FolderKind,
    ImageSource,
    RepositorySnapshot,
    RepositorySummary,
    SyntaxColors,
} from '../model/repository.types';
import type { DiffSides, FileSide } from '../model/sides';
import {
    blockKey,
    COLOR_BLOCK,
    type ColorBlock,
    type LineSpans,
    lineColors,
} from '../model/syntax';
import { type RepositoryPort, useRepositoryPort } from './repository.port';

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
const commitKeys = {
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
 * (decided with its cases in docs/features/projects.md). The project on screen is read at once
 * when its watcher saw a change while the window was hidden.
 */
const READ_AGAIN_AFTER_MS = 30_000;

/**
 * A read that failed is never fresh: what fixed it outside (a WSL distro started from
 * another of its projects, a folder put back) shows the next time.
 */
function isOld({ state }: { state: QueryState<unknown> }): boolean {
    if (state.status === 'error') return true;
    const readAt = Math.max(state.dataUpdatedAt, state.errorUpdatedAt);
    return Date.now() - readAt > READ_AGAIN_AFTER_MS;
}

/**
 * What a folder of a project is, for the panels it has: `null` without folder, `waiting` until read.
 * No git runs, so it answers at once. Never starts a stopped WSL distro, for a card or for the
 * project opened: `stopped` says so, and `useStartFolder` starts it. A kind that cannot be read
 * otherwise counts as a repository, as every folder did before: its panels and the problems tell
 * why.
 */
export function useFolderKind(
    folder: ProjectFolder | null,
    { freshOnShow = false } = {},
): FolderKindState {
    const port = useRepositoryPort();
    const folderId = folder?.id ?? null;
    const query = useQuery({
        ...folderKindQuery(port, folderId ?? '', freshOnShow),
        enabled: folderId !== null,
    });
    if (!folderId) return { kind: null, waiting: false, stopped: false };
    return folderKindState(query);
}

/** What a folder is as its panels take it (`useFolderKind`). */
interface FolderKindState {
    kind: FolderKind | null;
    waiting: boolean;
    stopped: boolean;
}

/** The read of a folder's kind: one cache entry, whoever asks. */
function folderKindQuery(port: RepositoryPort, folderId: string, freshOnShow: boolean) {
    return {
        queryKey: repositoryKeys.kind(folderId),
        queryFn: () => port.getFolderKind(folderId, false),
        staleTime: Number.POSITIVE_INFINITY,
        refetchOnMount: freshOnShow
            ? (query: { state: QueryState<unknown> }) => (isOld(query) ? 'always' : false)
            : true,
    } as const;
}

function folderKindState(query: UseQueryResult<FolderKind>): FolderKindState {
    if (query.isError) {
        const stopped = hasErrorCode(query.error, 'distro_stopped');
        return { kind: 'repository', waiting: false, stopped };
    }
    return { kind: query.data ?? null, waiting: query.isPending, stopped: false };
}

/** What each of `folders` is, in their order (`useFolderKind`). */
function useFolderKinds(
    folders: readonly ProjectFolder[],
    freshOnShow: boolean,
): FolderKindState[] {
    const port = useRepositoryPort();
    return useQueries({
        queries: folders.map((folder) => folderKindQuery(port, folder.id, freshOnShow)),
    }).map(folderKindState);
}

/**
 * What a project's folders are, together, for its card's panels: a repository when one of them
 * is, else without git; `null` without folders, `waiting` until each is read. Never starts a
 * stopped WSL distro.
 */
export function useProjectKind(
    folders: readonly ProjectFolder[],
    { freshOnShow = false } = {},
): { kind: FolderKind | null; waiting: boolean } {
    const states = useFolderKinds(folders, freshOnShow);
    if (folders.length === 0) return { kind: null, waiting: false };
    const waiting = states.some((state) => state.waiting);
    const repository = states.some((state) => state.kind === 'repository');
    return { kind: repository ? 'repository' : 'plain', waiting };
}

/**
 * The summaries of a project's repositories among its folders, for its card: each read again as
 * it shows unless read in the last 30 s, never starting a stopped WSL distro. A folder without
 * git has none, and one whose kind is not read yet none yet.
 */
export function useRepositorySummaries(
    folders: readonly ProjectFolder[],
): { folder: ProjectFolder; summary: UseQueryResult<RepositorySummary> }[] {
    const port = useRepositoryPort();
    const kinds = useFolderKinds(folders, true);
    const repositories = folders.filter((_, index) => kinds[index].kind === 'repository');
    const summaries = useQueries({
        queries: repositories.map((folder) => summaryQuery(port, folder.id, true)),
    });
    return repositories.map((folder, index) => ({ folder, summary: summaries[index] }));
}

/**
 * Starts the stopped WSL distro that holds a folder of a project, as its Start button asks: the
 * one read that may, its answer the folder's kind.
 */
export function useStartFolder(folderId: string) {
    const port = useRepositoryPort();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => port.getFolderKind(folderId, true),
        onSuccess: (kind) => queryClient.setQueryData(repositoryKeys.kind(folderId), kind),
    });
}

/** A repository's snapshot; none read for a folder without git (`repository` false). */
export function useRepositorySnapshot(folderId: string, repository: boolean) {
    const port = useRepositoryPort();
    const queryClient = useQueryClient();
    return useQuery({
        queryKey: repositoryKeys.snapshot(folderId),
        queryFn: async () => {
            const snapshot = await port.getSnapshot(folderId);
            // the same git output, so the breadcrumb needs no call of its own
            queryClient.setQueryData(repositoryKeys.summary(folderId), snapshot.summary);
            return snapshot;
        },
        enabled: repository,
    });
}

/** A folder's snapshot as last read, if any, without reading one or watching for the next. */
export function useSnapshotOf(): (folderId: string) => RepositorySnapshot | undefined {
    const queryClient = useQueryClient();
    return (folderId) => queryClient.getQueryData(repositoryKeys.snapshot(folderId));
}

/**
 * A repository at a glance, for every project on screen. `fromSnapshot` says the Changes panel
 * shows it: its snapshot then brings the summary, and the summary is never fetched on its own.
 * `freshOnShow` reads it again each time the component shows, as the cards of all projects do,
 * unless it was read in the last 30 s.
 *
 * A summary is kept until something says it changed: the watcher, for the folder on screen; the
 * window coming back, when an agent may have worked on any project meanwhile; or the cards of all
 * projects showing. The other projects are not watched: nothing runs for them while nobody looks.
 */
export function useRepositorySummary(
    folderId: string,
    { fromSnapshot = false, freshOnShow = false } = {},
) {
    const port = useRepositoryPort();
    return useQuery({ ...summaryQuery(port, folderId, freshOnShow), enabled: !fromSnapshot });
}

/** The read of a repository's summary: one cache entry, whoever asks. */
function summaryQuery(port: RepositoryPort, folderId: string, freshOnShow: boolean) {
    return {
        queryKey: repositoryKeys.summary(folderId),
        queryFn: () => port.getSummary(folderId),
        staleTime: Number.POSITIVE_INFINITY,
        refetchOnMount: freshOnShow
            ? (query: { state: QueryState<unknown> }) => (isOld(query) ? 'always' : false)
            : true,
    } as const;
}

export function useFileDiff(folderId: string, request: FileDiffRequest | null) {
    const port = useRepositoryPort();
    return useQuery({
        queryKey: request
            ? repositoryKeys.diff(folderId, request)
            : [...repositoryKeys.of(folderId), 'none'],
        queryFn: () => (request ? port.getFileDiff(folderId, request) : null),
        enabled: request !== null,
    });
}

/** How much of a project's changes is formatting only, over every file, once asked. */
export interface FormattingCheck {
    /** The answer for the snapshot on screen: null when cut, undefined until asked. */
    totals: FormattingTotals | null | undefined;
    checking: boolean;
    error: Error | null;
    check: () => void;
}

/** The snapshot on screen, and when it was read (`useRepositorySnapshot`). */
export type SnapshotRead = Pick<UseQueryResult<RepositorySnapshot>, 'data' | 'dataUpdatedAt'>;

/**
 * How much of a project's changes is formatting only: a diff of every changed file, run only by
 * `check`. The answer, or its failure, holds for the snapshot read it was asked on, by its time:
 * a read after a change on disk keeps the same files when their counts are the same, though
 * their lines may not be. The next read hides it in every panel; nothing reads it again unasked.
 */
export function useFormattingCheck(folderId: string, snapshot: SnapshotRead): FormattingCheck {
    const port = useRepositoryPort();
    const files = snapshot.data?.files;
    const readAt = snapshot.dataUpdatedAt;
    const query = useQuery({
        queryKey: repositoryKeys.formatting(folderId),
        queryFn: async () => ({
            files,
            readAt,
            ignoring: await port.getChangesIgnoringWhitespace(folderId),
        }),
        enabled: false,
        staleTime: Number.POSITIVE_INFINITY,
    });
    const answer = files && query.data?.readAt === readAt ? query.data : null;
    const totals = useMemo(
        () => (answer?.files ? formattingTotals(answer.files, answer.ignoring) : undefined),
        [answer],
    );
    const { refetch } = query;
    const check = useCallback(() => void refetch(), [refetch]);
    const failed = !answer && query.errorUpdatedAt > readAt;
    return { totals, checking: query.isFetching, error: failed ? query.error : null, check };
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
export function useTreeDirectories(folderId: string, open: ReadonlySet<string>) {
    const port = useRepositoryPort();
    const queryClient = useQueryClient();
    // the folders read so far say which open folders show: one read brings the next
    const paths = foldersToRead(open, (path) =>
        queryClient.getQueryData<Directory>(repositoryKeys.directory(folderId, path)),
    );
    const { data, error } = useQueries({
        queries: paths.map((path) => ({
            queryKey: repositoryKeys.directory(folderId, path),
            queryFn: () => port.getDirectory(folderId, path),
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

/**
 * The tree's files by their last change, newest first, while `enabled` (Recent shows): any change
 * on disk reads them again, and so does the window shown after one.
 */
export function useRecentFiles(folderId: string, enabled: boolean) {
    const port = useRepositoryPort();
    return useQuery({
        queryKey: repositoryKeys.recent(folderId),
        queryFn: () => port.getRecentFiles(folderId),
        enabled,
    });
}

/** A file of the tree that did not change, as the Files panel shows it. */
export function useFileContent(folderId: string, path: string | null) {
    const port = useRepositoryPort();
    return useQuery({
        queryKey: path
            ? repositoryKeys.file(folderId, path)
            : [...repositoryKeys.of(folderId), 'none'],
        queryFn: () => (path ? port.getFileContent(folderId, path) : null),
        enabled: path !== null,
    });
}

/**
 * An image's URL and size: of the tree's file at `path`, from its stamp, read again, and so loaded
 * again, once the file changed; or of the git object `blob` (a side of the image's diff), which
 * never changes.
 */
export function useImageSource(folderId: string, path: string, blob: string | null = null) {
    const port = useRepositoryPort();
    const { data, isPending, isError, error } = useQuery({
        queryKey:
            blob === null
                ? repositoryKeys.stamp(folderId, path)
                : repositoryKeys.blob(folderId, blob),
        queryFn: async (): Promise<{ size: number; source: ImageSource }> => {
            if (blob !== null) {
                const size = await port.getBlobSize(folderId, blob);
                return { size, source: { kind: 'blob', blob } };
            }
            const stamp = await port.getFileStamp(folderId, path);
            return { size: stamp.size, source: { kind: 'file', stamp } };
        },
        staleTime: blob === null ? 0 : Number.POSITIVE_INFINITY,
    });
    return {
        size: data?.size,
        isPending,
        isError,
        error,
        tooLarge: data !== undefined && data.size > MAX_IMAGE_BYTES,
        url: data ? port.projectFileUrl(folderId, path, data.source) : null,
    };
}

/** A Markdown file of the tree as its preview shows it. */
export function useMarkdownPreview(folderId: string, path: string) {
    const port = useRepositoryPort();
    return useQuery({
        queryKey: repositoryKeys.preview(folderId, path),
        queryFn: () => port.getMarkdownPreview(folderId, path),
    });
}

/**
 * The last commits of the branch on screen, read only while `open`: the section is closed until
 * asked for, and costs nothing until then. Once open, a change of HEAD or refs reads it again.
 */
export function useRecentCommits(folderId: string, open: boolean) {
    const port = useRepositoryPort();
    return useQuery({
        queryKey: repositoryKeys.commits(folderId),
        queryFn: () => port.getRecentCommits(folderId),
        enabled: open,
    });
}

/** A repository's chart of commits: its folder, and its HEAD, which names what it read. */
export interface ActivitySource {
    folderId: string;
    head: string | null;
}

/**
 * The lines each commit of a repository's branch on screen changed since `since`: read once for a
 * HEAD and a first day, again only when either moves. None before the first commit.
 */
function activityQuery(port: RepositoryPort, { folderId, head }: ActivitySource, since: number) {
    return {
        queryKey: repositoryKeys.activity(folderId, head ?? '', since),
        queryFn: () => port.getCommitActivity(folderId, since),
        enabled: head !== null,
        staleTime: Number.POSITIVE_INFINITY,
    } as const;
}

/**
 * The commits of several repositories since `since`, together: a project's of several folders. A
 * repository before its first commit has none; `pending` until each is read.
 */
export function useCommitActivities(sources: readonly ActivitySource[], since: number) {
    const port = useRepositoryPort();
    const queries = useQueries({
        queries: sources.map((source) => activityQuery(port, source, since)),
    });
    const read = sources.flatMap((source, index) => (source.head === null ? [] : [queries[index]]));
    return {
        data: read.every((query) => query.data)
            ? mergedActivity(read.flatMap((query) => (query.data ? [query.data] : [])))
            : undefined,
        isError: read.some((query) => query.isError),
    };
}

/** The files a commit changed, read once: a commit never changes. */
export function useCommitFiles(folderId: string, commit: Commit | null) {
    const port = useRepositoryPort();
    const request = commit ? commitRequest(commit) : null;
    return useQuery({
        queryKey: request ? commitKeys.files(folderId, request) : ['commit', folderId, 'none'],
        queryFn: () => (request ? port.getCommitFiles(folderId, request) : null),
        enabled: request !== null,
        staleTime: Number.POSITIVE_INFINITY,
    });
}

export function useCommitFileDiff(folderId: string, request: CommitFileDiffRequest | null) {
    const port = useRepositoryPort();
    return useQuery({
        queryKey: request ? commitKeys.diff(folderId, request) : ['commit', folderId, 'none'],
        queryFn: () => (request ? port.getCommitFileDiff(folderId, request) : null),
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
    folderId: string,
    sides: DiffSides,
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
                    ? commitKeys.colors(folderId, source.version.sha, source.path, first)
                    : repositoryKeys.colors(folderId, source, first),
            queryFn: () =>
                port.getSyntaxColors(folderId, {
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

/** The failures of a folder's reads that need the user, the weightiest first. */
const FOLDER_FAILURES = [
    'distro_missing',
    'repository_missing',
    'helper_failed',
    'git_not_found',
] as const;
export type FolderFailure = (typeof FOLDER_FAILURES)[number];

/** Each folder's weightiest failure, as `<failure>\u0001<id>` joined by NUL (no id has either). */
function failedFolders(cache: QueryCache): string {
    const failures = new Map<string, FolderFailure>();
    for (const query of cache.findAll({ queryKey: repositoryKeys.all, type: 'all' })) {
        if (query.state.status !== 'error') continue;
        const failure = FOLDER_FAILURES.find((code) => hasErrorCode(query.state.error, code));
        if (!failure) continue;
        const id = query.queryKey[1] as string;
        const known = failures.get(id);
        if (!known || FOLDER_FAILURES.indexOf(failure) < FOLDER_FAILURES.indexOf(known)) {
            failures.set(id, failure);
        }
    }
    return [...failures]
        .map(([id, failure]) => `${failure}\u0001${id}`)
        .sort((a, b) => a.localeCompare(b))
        .join('\0');
}

/**
 * The folders whose reads failed in a way that needs the user (moved, a WSL distro gone, no git
 * there, the helper not starting), by id, from what was already read of them: nothing is fetched
 * to know it. One that reads well again leaves the map.
 */
export function useFolderFailures(): ReadonlyMap<string, FolderFailure> {
    const cache = useQueryClient().getQueryCache();
    const failed = useSyncExternalStore(
        // only a read ending or going changes a failure: not a query made, as one is while a
        // component renders
        (onChange) =>
            cache.subscribe(({ type }) => {
                if (type === 'updated' || type === 'removed') onChange();
            }),
        () => failedFolders(cache),
    );
    return useMemo(
        () =>
            new Map(
                (failed ? failed.split('\0') : []).map((entry) => {
                    const [failure, id] = entry.split('\u0001');
                    return [id, failure as FolderFailure];
                }),
            ),
        [failed],
    );
}

/** Reads again what is shown of a folder: after a fix, such as git installed in its distro. */
export function useReadFolderAgain(): (folderId: string) => void {
    const queryClient = useQueryClient();
    return useCallback(
        (folderId: string) => {
            const queryKey = repositoryKeys.of(folderId);
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
 * When it shows again, what is on screen is read again if the watcher saw its folder change
 * meanwhile, or if it is older than 30 s: the other folders are not watched, and the watcher
 * cannot see everything (a repository on a network drive). Shown again within 30 s with nothing
 * changed, as when switching back and forth with the agent's terminal, nothing runs.
 */
export function useRepositoryChangeSubscription() {
    const port = useRepositoryPort();
    const queryClient = useQueryClient();
    useEffect(
        () =>
            port.onRepositoryChanged(({ folderId, gitDir, paths, kindChanged }) => {
                const queryKey = repositoryKeys.of(folderId);
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
