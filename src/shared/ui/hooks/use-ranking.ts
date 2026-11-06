import { keepPreviousData, useQuery } from '@tanstack/react-query';

/** Names ranked for a query: their order, and whether it answers the query typed now. */
export interface Ranking {
    /**
     * The indexes of the names matching, best first; null while nothing is typed, or while the
     * first ranking of these names comes: the names show in their order.
     */
    order: readonly number[] | null;
    /**
     * Something is typed and the order shown does not answer it yet (the names in their order, or
     * the previous query's ranking): what is shown is not what to act on.
     */
    pending: boolean;
}

/** The same names in the same order: a list built again at each render is still these names. */
function sameNames(a: readonly string[], b: readonly string[]): boolean {
    return a === b || (a.length === b.length && a.every((name, index) => name === b[index]));
}

/**
 * `names` ranked for `query` as `rank` orders them (the palette's ranking of names, in the
 * backend). While the next ranking comes, the previous one stays, if it ranked the same names, so
 * the list does not jump; `pending` says it is not the answer yet.
 */
export function useRanking(
    rank: (query: string, names: readonly string[]) => Promise<number[]>,
    query: string,
    names: readonly string[],
): Ranking {
    const typed = query.trim();
    const ranked = useQuery({
        queryKey: ['rank-names', typed, names],
        queryFn: async () => ({ typed, names, order: await rank(typed, names) }),
        enabled: typed !== '',
        placeholderData: keepPreviousData,
        gcTime: 0,
    });
    const data =
        typed !== '' && ranked.data && sameNames(ranked.data.names, names) ? ranked.data : null;
    return { order: data?.order ?? null, pending: typed !== '' && data?.typed !== typed };
}
