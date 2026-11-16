import { useEffect, useState } from 'react';
import type { ContentEnd, ContentFile } from '../model/search.types';
import { type SearchPort, useSearchPort } from './search.port';

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

type Change = (current: ContentResults) => ContentResults;

/**
 * Whether `query` is long enough to search in contents: its characters counted as the backend
 * counts them (a code point each), the spaces around it left out.
 */
export function longEnoughToSearch(query: string): boolean {
    return Array.from(query.trim()).length >= MIN_CONTENT_QUERY;
}

const byPath = (a: ContentFile, b: ContentFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

function empty(query: string): ContentResults {
    return { query, files: [], status: 'searching', more: false, error: null };
}

const filesFound =
    (files: ContentFile[]): Change =>
    (current) => ({ ...current, files: [...current.files, ...files].sort(byPath) });

const ended =
    (end: ContentEnd): Change =>
    (current) => ({ ...current, status: 'done', more: end.more });

const failed =
    (error: unknown): Change =>
    (current) => ({ ...current, status: 'failed', error });

/** One search, each answer given to `update` as it comes, until it ends or fails. */
async function search(
    port: SearchPort,
    folderId: string,
    query: string,
    update: (change: Change) => void,
) {
    try {
        const end = await port.searchContents(folderId, query, (files) =>
            update(filesFound(files)),
        );
        if (!end.cancelled) update(ended(end));
    } catch (error) {
        update(failed(error));
    }
}

/**
 * The lines of a project's files where `query` is, as they come, once typing pauses. A new text
 * replaces the results once its first files come (or it ends with none), so the list does not
 * blink between keys; until the first answer, nothing found yet. A search no longer wanted (the
 * text changed, the palette went back to names or closed) stops in the backend. Null, and no
 * search, while `folderId` is null or the text is too short (`longEnoughToSearch`).
 */
export function useContentSearch(folderId: string | null, query: string): ContentResults | null {
    const port = useSearchPort();
    const [results, setResults] = useState<ContentResults | null>(null);
    const searchable = folderId !== null && longEnoughToSearch(query);

    useEffect(() => {
        if (!searchable || folderId === null) {
            setResults(null);
            return;
        }
        let live = true;
        let running = false;
        // the first answer of this search replaces the results of the one before
        let first = true;
        const update = (change: Change) => {
            if (!live) return;
            const fresh = first;
            first = false;
            setResults((current) => change(fresh || !current ? empty(query) : current));
        };
        const timer = setTimeout(() => {
            running = true;
            void search(port, folderId, query, update).finally(() => {
                running = false;
            });
        }, TYPING_PAUSE_MS);
        return () => {
            live = false;
            clearTimeout(timer);
            if (running) void port.stopContentSearch();
        };
    }, [port, folderId, query, searchable]);

    if (!searchable) return null;
    return results ?? empty(query);
}
