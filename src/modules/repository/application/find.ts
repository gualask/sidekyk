import { type SetStateAction, useEffect, useState } from 'react';
import type { FileFindAt } from '../model/targets';
import { useSessionState } from './session-state';

/** A text looked for in one file, from one of its lines or from its top: the viewer's find bar. */
interface FileFind {
    /** The file, as the viewer showing it names it. */
    file: string;
    query: string;
    line: number | null;
}

/** The find bar over a file: the text looked for, where to start, and its changes. */
interface FindBarState {
    query: string;
    /** The line of the file now to start from; the top when null. */
    line: number | null;
    onQuery: (query: string) => void;
    onClose: () => void;
}

/** What the viewer of a file finds with: its bar while open, and the ways to look further. */
export interface FileFinder {
    bar: FindBarState | null;
    /** Opens the bar over the file, empty, to look from its top (`⌘F`). */
    open: () => void;
    /** Looks for a text in all the project's files instead (`⌘F` again, from the bar). */
    findInFiles: (query: string) => void;
}

/**
 * The finder of the file `file`, from the text looked for in a viewer: the bar shows on its file
 * only.
 */
function finderOf(
    find: FileFind | null,
    setFind: (find: SetStateAction<FileFind | null>) => void,
    file: string,
    findInFiles: (query: string) => void,
): FileFinder {
    return {
        bar:
            find?.file === file
                ? {
                      query: find.query,
                      line: find.line,
                      onQuery: (query) => setFind({ ...find, query }),
                      onClose: () => setFind(null),
                  }
                : null,
        open: () => setFind({ file, query: '', line: null }),
        findInFiles,
    };
}

/**
 * The text looked for in a project's viewer, the same in both panels and kept for the session:
 * the bar shows on its file only, until closed or another file shows (`shown`, the shared
 * selection's path; null while it is not known yet).
 */
export function useFileFind(
    root: string,
    shown: string | null,
    findInFiles: (query: string) => void,
) {
    const [find, setFind] = useSessionState<FileFind | null>(`find:${root}`, null);
    // in an effect: the session's store is outside React, and is not set while rendering
    useEffect(() => {
        if (find && shown !== null && find.file !== shown) setFind(null);
    }, [find, shown, setFind]);
    return {
        /** Looks for a text in a file, from one of its lines. */
        open: (path: string, at: FileFindAt) => setFind({ file: path, ...at }),
        /** Closes the bar, as the panel turns to a file that is not of the working tree. */
        close: () => setFind(null),
        /** What the viewer of a file of the working tree finds with. */
        finderFor: (path: string) => finderOf(find, setFind, path, findInFiles),
    };
}

/**
 * The text looked for in a commit's file, while the panel shows it: `shown` names the commit and
 * the file (null for none), and the bar goes once another, or none, shows.
 */
export function useCommitFileFind(shown: string | null, findInFiles: (query: string) => void) {
    const [find, setFind] = useState<FileFind | null>(null);
    // while rendering, as React's own state allows: the bar never shows over the next file
    if (find && find.file !== shown) setFind(null);
    return shown === null ? null : finderOf(find, setFind, shown, findInFiles);
}
