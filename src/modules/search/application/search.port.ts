import { createContext, createElement, type ReactNode, useContext } from 'react';
import type { SearchRequest, SearchResults } from '../model/search.types';

/** The search's runtime boundary: the native backend, or a fixture in browser dev mode. */
export interface SearchPort {
    search(request: SearchRequest): Promise<SearchResults>;
}

const SearchPortContext = createContext<SearchPort | null>(null);

export function SearchProvider({ value, children }: { value: SearchPort; children: ReactNode }) {
    return createElement(SearchPortContext.Provider, { value }, children);
}

export function useSearchPort(): SearchPort {
    const port = useContext(SearchPortContext);
    if (!port) {
        throw new Error('useSearchPort must be used within SearchProvider');
    }
    return port;
}
