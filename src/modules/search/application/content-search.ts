import { useEffect, useState } from 'react';
import type { ContentFile } from '../model/search.types';
import { useSearchPort } from './search.port';

/** Shorter texts match nearly every line of a project, as the backend's `MIN_QUERY_CHARS`. */
export const MIN_CONTENT_QUERY = 2;

/** A pause in typing before a search starts, so each key does not read every file. */
const TYPING_PAUSE_MS = 150;

/** What a search in contents found so far, for which text, and whether it is over. */
export interface ContentResults {
    query: string;
    /** By path. */
    files: ContentFile[];
    status: 'searching' | 'done' | 'failed';
    /** More lines matched than were sent. */
    more: boolean;
    error: unknown;
}

const byPath = (a: ContentFile, b: ContentFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

function empty(query: string): ContentResults {
    return { query, files: [], status: 'searching', more: false, error: null };
}

/**
 * The lines of a project's files where `query` is, as they come, once typing pauses. A new text
 * replaces the results once its first files come (or it ends with none), so the list does not
 * blink between keys. A search no longer wanted (the text changed, the palette went back to names
 * or closed) stops in the backend. Nothing while `projectId` is null or the text is too short.
 */
export function useContentSearch(projectId: string | null, query: string): ContentResults | null {
    const port = useSearchPort();
    const [results, setResults] = useState<ContentResults | null>(null);
    const searchable = projectId !== null && query.trim().length >= MIN_CONTENT_QUERY;

    useEffect(() => {
        if (!searchable || projectId === null) {
            setResults(null);
            return;
        }
        let live = true;
        let running = false;
        // the first answer of this search replaces the results of the one before
        let first = true;
        const update = (change: (current: ContentResults) => ContentResults) => {
            if (!live) return;
            const fresh = first;
            first = false;
            setResults((current) => change(fresh || !current ? empty(query) : current));
        };
        const timer = setTimeout(() => {
            running = true;
            port.searchContents(projectId, query, (files) =>
                update((current) => ({
                    ...current,
                    files: [...current.files, ...files].sort(byPath),
                })),
            )
                .then((end) => {
                    running = false;
                    if (!end.cancelled) {
                        update((current) => ({ ...current, status: 'done', more: end.more }));
                    }
                })
                .catch((error: unknown) => {
                    running = false;
                    update((current) => ({ ...current, status: 'failed', error }));
                });
        }, TYPING_PAUSE_MS);
        return () => {
            live = false;
            clearTimeout(timer);
            if (running) void port.stopContentSearch();
        };
    }, [port, projectId, query, searchable]);

    return searchable ? results : null;
}
