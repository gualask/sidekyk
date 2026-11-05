import type { PanelTarget } from '@/shared/panels/panel';

/** A text to look for in a file, from one of its lines: what the palette's search in contents opens. */
export interface FileFindAt {
    query: string;
    line: number;
}

/** Lines of a file, by their numbers in it now, `first` to `last` included: what a note names. */
export interface FileLines {
    first: number;
    last: number;
}

/**
 * What Changes or Files is asked to show: a file by its path, which Changes shows as a change
 * when it is one, on one of its hunks or on its first, and maybe with a text to look for in it;
 * or, in Files, on some of its lines, marked.
 */
export interface Shown {
    path: string;
    hunk: number | null;
    find: FileFindAt | null;
    lines: FileLines | null;
}

/**
 * Asks Changes or Files to show a file, at one of its hunks if it changed, or at a text in it, or
 * (Files) at some of its lines.
 */
export function fileTarget(
    path: string,
    hunk: number | null = null,
    find: FileFindAt | null = null,
    lines: FileLines | null = null,
): PanelTarget {
    const shown: Shown = { path, hunk, find, lines };
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

function isLines(value: unknown): value is FileLines {
    return (
        typeof value === 'object' &&
        value !== null &&
        'first' in value &&
        typeof value.first === 'number' &&
        'last' in value &&
        typeof value.last === 'number'
    );
}

function isShown(value: unknown): value is Shown {
    if (typeof value !== 'object' || value === null) return false;
    const lines = 'lines' in value ? value.lines : undefined;
    if (lines !== null && !isLines(lines)) return false;
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
