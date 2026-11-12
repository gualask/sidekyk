import { useQueries, useQuery } from '@tanstack/react-query';
import { mergedActivity } from '../../model/history/activity';
import { commitRequest } from '../../model/history/commits';
import type { Commit, CommitFileDiffRequest } from '../../model/repository.types';
import { type RepositoryPort, useRepositoryPort } from '../repository.port';
import { commitKeys, repositoryKeys } from './repository-keys';

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
