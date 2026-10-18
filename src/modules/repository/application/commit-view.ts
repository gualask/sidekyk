import { useState } from 'react';
import type { Commit, FileChange } from '../model/repository.types';
import { useCommitFiles } from './repository.queries';

const NO_FILES: readonly FileChange[] = [];

/**
 * A commit looked at in the Changes panel, in place of the working tree: which one, its files and
 * the one open, and whether the recent commits are open. Leaving it closes them too, out of the
 * way, whether by its × or by `Esc`.
 */
export function useCommitView(projectId: string) {
    const [commit, setCommit] = useState<Commit | null>(null);
    const [path, setPath] = useState<string | null>(null);
    const [listOpen, setListOpen] = useState(false);
    const files = useCommitFiles(projectId, commit);
    const list = files.data?.files ?? NO_FILES;
    // until a file is picked, and when the one picked is not listed, the first one is open
    const file = list.find((f) => f.path === path) ?? list[0] ?? null;

    return {
        commit,
        files,
        file,
        listOpen,
        setListOpen,
        view(next: Commit) {
            setCommit(next);
            setPath(null);
        },
        open(next: FileChange) {
            setPath(next.path);
        },
        /** The file `step` rows away from the open one, if there is one. */
        neighbour(step: number): FileChange | undefined {
            return file ? list[list.indexOf(file) + step] : undefined;
        },
        leave() {
            setCommit(null);
            setListOpen(false);
        },
    };
}
