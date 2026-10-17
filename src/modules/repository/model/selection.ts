import { changeOf, fileKey } from './file-groups';
import type { ChangedFile } from './repository.types';
import type { Shown } from './targets';

/**
 * The file shown of a project, one for both panels: the Changes list selects it, the tree reveals
 * it, the viewer shows it. A changed file of the list (the first while none is picked), or a file
 * of the tree by its path, a change while it is one. `back` is the changed file to go back to from
 * a file that did not change.
 */
export type Selection =
    | { kind: 'change'; key: string | null }
    | { kind: 'path'; path: string; back: string | null };

export const FIRST_CHANGE: Selection = { kind: 'change', key: null };

/** The selection after a panel asks for a file. */
export function selectionOf(shown: Shown, current: Selection): Selection {
    if (shown.kind === 'change') return { kind: 'change', key: shown.key };
    const back = current.kind === 'path' ? current.back : current.key;
    return { kind: 'path', path: shown.path, back };
}

/**
 * What a selection shows among the changed files, in the list's order: the change, if it is one,
 * and the path the tree reveals, if the file is on disk. A changed file that left the list
 * (committed, reverted) hands the selection to the first.
 */
export function selectedFile(
    selection: Selection,
    ordered: readonly ChangedFile[],
): { change: ChangedFile | null; path: string | null } {
    if (selection.kind === 'path') {
        return { change: changeOf(ordered, selection.path), path: selection.path };
    }
    const change = ordered.find((file) => fileKey(file) === selection.key) ?? ordered[0] ?? null;
    return { change, path: change && change.kind !== 'deleted' ? change.path : null };
}
