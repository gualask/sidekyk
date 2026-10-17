import { useEffect } from 'react';
import type { FileFindAt } from '../model/targets';
import { useSessionState } from './session-state';

/** A text looked for in one file of a project, from one of its lines: the viewer's find bar. */
interface FileFind extends FileFindAt {
    path: string;
}

/** The find bar over a file: the text looked for, where to start, and its changes. */
export interface FindBarState {
    query: string;
    /** The line of the file now to start from. */
    line: number | null;
    onQuery: (query: string) => void;
    onClose: () => void;
}

/**
 * The text looked for in a project's viewer, the same in both panels and kept for the session:
 * the bar shows on its file only, until closed or another file shows (`shown`, the shared
 * selection's path; null while it is not known yet).
 */
export function useFileFind(root: string, shown: string | null) {
    const [find, setFind] = useSessionState<FileFind | null>(`find:${root}`, null);
    useEffect(() => {
        if (find && shown !== null && find.path !== shown) setFind(null);
    }, [find, shown, setFind]);
    return {
        /** Looks for a text in a file, from one of its lines. */
        open: (path: string, at: FileFindAt) => setFind({ path, ...at }),
        /** The bar over a file, while a text is looked for in it. */
        barFor: (path: string): FindBarState | null =>
            find?.path === path
                ? {
                      query: find.query,
                      line: find.line,
                      onQuery: (query) => setFind({ ...find, query }),
                      onClose: () => setFind(null),
                  }
                : null,
    };
}
