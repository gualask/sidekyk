import type { PanelTarget } from '@/shared/panels/panel';
import { fileKey } from './file-groups';
import type { ChangedFile } from './repository.types';

/**
 * What Changes or Files is asked to show: a changed file in one area (`fileKey`), or any file of
 * the tree by its path, which Changes shows as a change when it is one. Either opens on one of its
 * hunks, or on its first.
 */
export type Shown =
    | { kind: 'change'; key: string; hunk: number | null }
    | { kind: 'path'; path: string; hunk: number | null };

function target(shown: Shown): PanelTarget {
    return { key: JSON.stringify(shown) };
}

/** Asks the Changes panel to show a changed file, in one area. */
export function changesTarget(file: Pick<ChangedFile, 'area' | 'path'>): PanelTarget {
    return target({ kind: 'change', key: fileKey(file), hunk: null });
}

/** Asks Changes or Files to show a file of the tree, at one of its hunks if it changed. */
export function fileTarget(path: string, hunk: number | null = null): PanelTarget {
    return target({ kind: 'path', path, hunk });
}

function isShown(value: unknown): value is Shown {
    if (typeof value !== 'object' || value === null || !('kind' in value)) return false;
    const hunk = 'hunk' in value ? value.hunk : undefined;
    if (hunk !== null && typeof hunk !== 'number') return false;
    if (value.kind === 'change') return 'key' in value && typeof value.key === 'string';
    if (value.kind === 'path') return 'path' in value && typeof value.path === 'string';
    return false;
}

/** What a target of `changesTarget` or `fileTarget` asks for; null for any other. */
export function shownBy({ key }: PanelTarget): Shown | null {
    try {
        const shown: unknown = JSON.parse(key);
        return isShown(shown) ? shown : null;
    } catch {
        return null;
    }
}
