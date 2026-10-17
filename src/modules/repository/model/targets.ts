import type { PanelTarget } from '@/shared/panels/panel';

/**
 * What Changes or Files is asked to show: a file by its path, which Changes shows as a change
 * when it is one, on one of its hunks or on its first.
 */
export interface Shown {
    path: string;
    hunk: number | null;
}

/** Asks Changes or Files to show a file, at one of its hunks if it changed. */
export function fileTarget(path: string, hunk: number | null = null): PanelTarget {
    const shown: Shown = { path, hunk };
    return { key: JSON.stringify(shown) };
}

function isShown(value: unknown): value is Shown {
    if (typeof value !== 'object' || value === null) return false;
    const hunk = 'hunk' in value ? value.hunk : undefined;
    if (hunk !== null && typeof hunk !== 'number') return false;
    return 'path' in value && typeof value.path === 'string';
}

/** What a target of `fileTarget` asks for; null for any other. */
export function shownBy({ key }: PanelTarget): Shown | null {
    try {
        const shown: unknown = JSON.parse(key);
        return isShown(shown) ? shown : null;
    } catch {
        return null;
    }
}
