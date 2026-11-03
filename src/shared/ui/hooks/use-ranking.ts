import { keepPreviousData, useQuery } from '@tanstack/react-query';

/**
 * The indexes of `names` matching `query`, best first, as `rank` orders them (the palette's
 * ranking of names, in the backend); null while nothing is typed, or while the first ranking of
 * these names comes: the names show in their order. While the next ranking comes, the previous
 * stays, if it ranked the same names.
 */
export function useRanking(
    rank: (query: string, names: readonly string[]) => Promise<number[]>,
    query: string,
    names: readonly string[],
): readonly number[] | null {
    const typed = query.trim();
    const ranked = useQuery({
        queryKey: ['rank-names', typed, names],
        queryFn: async () => ({ names, order: await rank(typed, names) }),
        enabled: typed !== '',
        placeholderData: keepPreviousData,
        gcTime: 0,
    });
    return typed !== '' && ranked.data?.names === names ? ranked.data.order : null;
}
