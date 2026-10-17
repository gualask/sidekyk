import type { PanelTarget } from '@/shared/panels/panel';

/** A text to look for in a file, from one of its lines: what the palette's search in contents opens. */
export interface FileFindAt {
    query: string;
    line: number;
}

/**
 * What Changes or Files is asked to show: a file by its path, which Changes shows as a change
 * when it is one, on one of its hunks or on its first, and maybe with a text to look for in it.
 */
export interface Shown {
    path: string;
    hunk: number | null;
    find: FileFindAt | null;
}

/** Asks Changes or Files to show a file, at one of its hunks if it changed, or at a text in it. */
export function fileTarget(
    path: string,
    hunk: number | null = null,
    find: FileFindAt | null = null,
): PanelTarget {
    const shown: Shown = { path, hunk, find };
    return { key: JSON.stringify(shown) };
}

function isFind(value: unknown): value is FileFindAt {
    return (
        typeof value === 'object' &&
        value !== null &&
        'query' in value &&
        typeof value.query === 'string' &&
        'line' in value &&
        typeof value.line === 'number'
    );
}

function isShown(value: unknown): value is Shown {
    if (typeof value !== 'object' || value === null) return false;
    const hunk = 'hunk' in value ? value.hunk : undefined;
    if (hunk !== null && typeof hunk !== 'number') return false;
    const find = 'find' in value ? value.find : undefined;
    if (find !== null && !isFind(find)) return false;
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
