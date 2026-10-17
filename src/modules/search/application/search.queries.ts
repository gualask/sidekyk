import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchPort } from './search.port';

/**
 * The palette's matches for what is typed, ranked in the backend. While the next ones come, the
 * previous stay on screen; nothing is kept once the palette closes.
 */
export function useSearch(query: string, panels: readonly string[], root: string | null) {
    const port = useSearchPort();
    return useQuery({
        queryKey: ['search', query, panels, root],
        queryFn: () => port.search({ query, panels: [...panels], root }),
        placeholderData: keepPreviousData,
        gcTime: 0,
    });
}
