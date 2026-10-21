import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchPort } from './search.port';

/**
 * The palette's matches for what is typed, ranked in the backend, with the query they answer.
 * While the next ones come, the previous stay on screen; nothing is kept once the palette closes.
 */
export function useSearch(
    query: string,
    panels: readonly string[],
    projectId: string | null,
    enabled = true,
) {
    const port = useSearchPort();
    return useQuery({
        queryKey: ['search', query, panels, projectId],
        queryFn: async () => ({
            query,
            results: await port.search({ query, panels: [...panels], projectId }),
        }),
        enabled,
        placeholderData: keepPreviousData,
        gcTime: 0,
    });
}
