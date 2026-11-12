import type { ChangedFile, Commit, FileChange } from '../../model/repository.types';
import { fileKey } from '../../model/tree/file-groups';

/** What names a commit's file shown, as a working tree file's key does. */
export function commitFileKey(sha: string, path: string): string {
    return `${sha}:${path}`;
}

/**
 * What names the file shown, which its view and find bar follow: of the commit viewed, else of the
 * working tree, changed (`selected`) or not (`unchanged`); null for none.
 */
export function shownKeyOf(
    viewed: Commit | null,
    commitFile: FileChange | null,
    selected: ChangedFile | null,
    unchanged: string | null,
): string | null {
    if (viewed) return commitFile ? commitFileKey(viewed.sha, commitFile.path) : null;
    return selected ? fileKey(selected) : unchanged;
}
