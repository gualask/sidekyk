import type { ChangedFile } from './repository.types';

/** A changed file for a test: an unstaged edit adding one line, but for what `fields` say. */
export function changedFile(path: string, fields: Partial<ChangedFile> = {}): ChangedFile {
    return {
        path,
        origPath: null,
        area: 'unstaged',
        kind: 'modified',
        additions: 1,
        deletions: 0,
        binary: false,
        oldBlob: null,
        newBlob: null,
        ...fields,
    };
}
