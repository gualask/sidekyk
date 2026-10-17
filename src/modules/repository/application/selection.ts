import { useMemo } from 'react';
import { orderedFiles } from '../model/file-groups';
import { FIRST_CHANGE, type Selection, selectedFile } from '../model/selection';
import { useRepositorySnapshot } from './repository.queries';
import { useSessionState } from './session-state';

/**
 * The file shown of a project, the same in both panels and kept for the session, with what it
 * shows among the changed files: the snapshot it comes from, the changed files in the list's
 * order, the change (if it is one) and the path the tree reveals.
 */
export function useSelectedFile(root: string) {
    const snapshot = useRepositorySnapshot(root);
    const [selection, setSelection] = useSessionState<Selection>(`selection:${root}`, FIRST_CHANGE);
    const files = useMemo(() => orderedFiles(snapshot.data?.files ?? []), [snapshot.data]);
    return { snapshot, files, selection, setSelection, ...selectedFile(selection, files) };
}
