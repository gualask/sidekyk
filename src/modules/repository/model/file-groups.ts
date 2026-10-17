import type { ChangeArea, ChangedFile } from './repository.types';

export interface FileGroup {
    area: ChangeArea;
    label: string;
    files: ChangedFile[];
}

/** What the agent left in the working tree first; staged work is what was already reviewed. */
const AREAS: readonly { area: ChangeArea; label: string }[] = [
    { area: 'unstaged', label: 'Changes' },
    { area: 'untracked', label: 'New files' },
    { area: 'staged', label: 'Staged' },
];

/** Same order as `localeCompare`, without setting up the comparison on every call. */
const byPath = new Intl.Collator().compare;

export function groupFiles(files: readonly ChangedFile[]): FileGroup[] {
    return AREAS.map(({ area, label }) => ({
        area,
        label,
        files: files.filter((file) => file.area === area).sort((a, b) => byPath(a.path, b.path)),
    })).filter((group) => group.files.length > 0);
}

/** A file in the order the list shows it, for keyboard navigation. */
export function orderedFiles(files: readonly ChangedFile[]): ChangedFile[] {
    return groupFiles(files).flatMap((group) => group.files);
}

/** The sidebar as one flat list, so only the rows on screen are rendered. */
export type FileListRow =
    | { kind: 'group'; area: ChangeArea; label: string; count: number; first: boolean }
    | { kind: 'file'; file: ChangedFile };

export function fileListRows(files: readonly ChangedFile[]): FileListRow[] {
    return groupFiles(files).flatMap((group, index): FileListRow[] => [
        {
            kind: 'group',
            area: group.area,
            label: group.label,
            count: group.files.length,
            first: index === 0,
        },
        ...group.files.map((file): FileListRow => ({ kind: 'file', file })),
    ]);
}

/**
 * The change of a path that a panel shows, in the order the list has them (the working tree's
 * edits first): its hunks are then the same in Changes and in Files. A deleted file is not on
 * disk, nor in the tree.
 */
export function changeOf(ordered: readonly ChangedFile[], path: string): ChangedFile | null {
    return ordered.find((file) => file.path === path && file.kind !== 'deleted') ?? null;
}

export function fileKey(file: Pick<ChangedFile, 'area' | 'path'>): string {
    return `${file.area}:${file.path}`;
}

export function splitPath(path: string): { name: string; dir: string } {
    const slash = path.lastIndexOf('/');
    return slash < 0
        ? { name: path, dir: '' }
        : { name: path.slice(slash + 1), dir: path.slice(0, slash) };
}
