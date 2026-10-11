import type { ChangeArea, ChangedFile, ChangeKind } from './repository.types';

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

export function groupFiles(files: readonly ChangedFile[]): FileGroup[] {
    return AREAS.map(({ area, label }) => ({
        area,
        label,
        files: files
            .filter((file) => file.area === area)
            .sort((a, b) => a.path.localeCompare(b.path)),
    })).filter((group) => group.files.length > 0);
}

/** A file in the order the list shows it, for keyboard navigation. */
export function orderedFiles(files: readonly ChangedFile[]): ChangedFile[] {
    return groupFiles(files).flatMap((group) => group.files);
}

export function fileKey(file: Pick<ChangedFile, 'area' | 'path'>): string {
    return `${file.area}:${file.path}`;
}

export const KIND_BADGE: Record<ChangeKind, string> = {
    added: 'A',
    modified: 'M',
    deleted: 'D',
    renamed: 'R',
    copied: 'C',
    'type-changed': 'T',
    untracked: 'U',
    conflicted: '!',
};

export function splitPath(path: string): { name: string; dir: string } {
    const slash = path.lastIndexOf('/');
    return slash < 0
        ? { name: path, dir: '' }
        : { name: path.slice(slash + 1), dir: path.slice(0, slash) };
}
