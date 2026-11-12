import type { ChangedFile, Commit, FileChange, FileVersion } from '../repository.types';

/** One version of a file: a side of a diff, or the file the Files panel shows. */
export interface FileSide {
    path: string;
    version: FileVersion;
}

/**
 * The versions a diff compares, old and new: what its lines take their colors from, what an
 * image's diff shows. A side is null when there is none (a new file, a root commit).
 */
export interface DiffSides {
    old: FileSide | null;
    new: FileSide | null;
}

/** The sides of a working-tree change: an area compares two of the working tree, index and HEAD. */
export function changeSides(file: Pick<ChangedFile, 'path' | 'origPath' | 'area'>): DiffSides {
    const was = file.origPath ?? file.path;
    if (file.area === 'staged') {
        return {
            old: { path: was, version: { kind: 'head' } },
            new: { path: file.path, version: { kind: 'index' } },
        };
    }
    return {
        old: file.area === 'unstaged' ? { path: was, version: { kind: 'index' } } : null,
        new: { path: file.path, version: { kind: 'worktree' } },
    };
}

/** The sides of a file of a commit: the commit, against its parent. */
export function commitSides(
    commit: Pick<Commit, 'sha' | 'parent'>,
    file: Pick<FileChange, 'path' | 'origPath'>,
): DiffSides {
    return {
        old: commit.parent
            ? { path: file.origPath ?? file.path, version: { kind: 'commit', sha: commit.parent } }
            : null,
        new: { path: file.path, version: { kind: 'commit', sha: commit.sha } },
    };
}

/** A file of the working tree, as the Files panel shows it. */
export function fileSides(path: string): DiffSides {
    return { old: null, new: { path, version: { kind: 'worktree' } } };
}

/** A side of an image's diff, with its git object; null for the working tree's file. */
export type ImageSide = FileSide & { blob: string | null };

export interface ImageSides {
    old: ImageSide | null;
    new: ImageSide | null;
}

/**
 * The sides of a changed image that have a file: a git version's by its object (none when the file
 * is not there, added or deleted), the working tree's unless the file was deleted from it.
 */
export function imageSides(
    sides: DiffSides,
    file: Pick<FileChange, 'kind' | 'oldBlob' | 'newBlob'>,
): ImageSides {
    const side = (at: FileSide | null, blob: string | null): ImageSide | null => {
        if (!at) return null;
        if (at.version.kind === 'worktree') {
            return file.kind === 'deleted' ? null : { ...at, blob: null };
        }
        return blob === null ? null : { ...at, blob };
    };
    return { old: side(sides.old, file.oldBlob), new: side(sides.new, file.newBlob) };
}
