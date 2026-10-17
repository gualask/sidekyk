import { createContext, createElement, type ReactNode, useContext } from 'react';
import type { ContentEnd, ContentFile, SearchRequest, SearchResults } from '../model/search.types';

/** The search's runtime boundary: the native backend, or a fixture in browser dev mode. */
export interface SearchPort {
    search(request: SearchRequest): Promise<SearchResults>;
    /**
     * The lines of a project's files where `query` is, given to `onFiles` as they are found; a
     * newer search stops this one.
     */
    searchContents(
        root: string,
        query: string,
        onFiles: (files: ContentFile[]) => void,
    ): Promise<ContentEnd>;
    /** Stops the search in contents going on: the palette closed. */
    stopContentSearch(): Promise<void>;
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
