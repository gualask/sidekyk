import { useMemo } from 'react';
import { useSessionState } from '@/shared/ui/session-state';
import { orderedFiles } from '../model/file-groups';
import { FIRST_CHANGE, type Selection, selectedFile } from '../model/selection';
import { useRepositorySnapshot, useSnapshotOf } from './repository.queries';

const selectionKey = (projectId: string) => `selection:${projectId}`;

/**
 * The file shown of a project, the same in both panels and kept for the session, with what it
 * shows among the changed files: the snapshot it comes from, the changed files in the list's
 * order, the change (if it is one) and the path the tree reveals. A folder without git
 * (`repository` false) has no snapshot and no changed files.
 */
export function useSelectedFile(projectId: string, repository: boolean) {
    const snapshot = useRepositorySnapshot(projectId, repository);
    const [selection, setSelection] = useSessionState<Selection>(
        selectionKey(projectId),
        FIRST_CHANGE,
    );
    const files = useMemo(() => orderedFiles(snapshot.data?.files ?? []), [snapshot.data]);
    return { snapshot, files, selection, setSelection, ...selectedFile(selection, files) };
}

/**
 * The path of the file a project shows, as `useSelectedFile` finds it, worked out when asked and
 * from the snapshot already read, never reading one: for the palette, which lists that file's
 * matches first. Null without a project, or with nothing shown.
 */
export function useShownFile(projectId: string | null): () => string | null {
    const [selection] = useSessionState<Selection>(selectionKey(projectId ?? ''), FIRST_CHANGE);
    const snapshotOf = useSnapshotOf();
    return () => {
        if (!projectId) return null;
        const files = orderedFiles(snapshotOf(projectId)?.files ?? []);
        const { change, path } = selectedFile(selection, files);
        return change?.path ?? path;
    };
}
