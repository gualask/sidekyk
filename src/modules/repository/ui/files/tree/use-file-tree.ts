import { useMemo } from 'react';
import { useSessionState } from '@/shared/ui/session-state';
import { useTreeDirectories } from '../../../application/queries/file-reads';
import { foldersAbove, treeRows } from '../../../model/tree/file-tree';

/** The tree of a project, kept for the session. */
interface TreeState {
    /** The folders open, by path. A folder closed above keeps its own open. */
    open: ReadonlySet<string>;
    /** The row the keyboard is on: the file shown, or a folder moved to. */
    selected: string | null;
}

const CLOSED: TreeState = { open: new Set(), selected: null };

/**
 * The tree of a folder, kept for the session: its folders open, its row selected, and the rows
 * of the folders read so far.
 */
export function useFileTree(folderId: string) {
    const [state, setState] = useSessionState<TreeState>(`tree:${folderId}`, CLOSED);
    const { open, selected } = state;
    const { read, error } = useTreeDirectories(folderId, open);
    const rows = useMemo(() => treeRows(open, read), [open, read]);
    return {
        open,
        selected,
        rows,
        error,
        /** The read of the top folder was cut: it has too many files. */
        truncated: () => read('')?.truncated ?? false,
        /** The folders above `path` open, and its row selected. */
        reveal: (path: string) =>
            setState((current) => ({
                open: new Set([...current.open, ...foldersAbove(path)]),
                selected: path,
            })),
        /** A folder opened or closed, and its row selected. */
        toggle: (path: string) =>
            setState((current) => {
                const next = new Set(current.open);
                if (!next.delete(path)) next.add(path);
                return { ...current, open: next, selected: path };
            }),
        select: (path: string) => setState((current) => ({ ...current, selected: path })),
        /** Every folder closed, as VS Code's "Collapse Folders in Explorer". */
        collapse: () => setState((current) => ({ ...current, open: new Set() })),
    };
}

export type FileTreeState = ReturnType<typeof useFileTree>;
