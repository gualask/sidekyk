import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { type FormattingTotals, formattingTotals } from '../../model/formatting';
import type { RepositorySnapshot } from '../../model/repository.types';
import { useRepositoryPort } from '../repository.port';
import { repositoryKeys } from './repository-keys';

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
