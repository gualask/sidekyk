import type { DiffRow } from './diff-rows';

/** Where the text looked for is in the viewer: its row, and its UTF-16 offsets in the row's text. */
export interface FindMatch {
    row: number;
    start: number;
    end: number;
}

/**
 * The text as typed, literally; case is ignored unless it has a capital letter, as the search in
 * contents does (`src-tauri/crates/core/src/modules/search/contents.rs`). Null when nothing is
 * typed.
 */
function findPattern(query: string): RegExp | null {
    if (!query) return null;
    const literal = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(literal, /\p{Lu}/u.test(query) ? 'gu' : 'giu');
}

/** Every place the text is in the rows' lines, in order. */
export function findMatches(rows: readonly DiffRow[], query: string): FindMatch[] {
    const pattern = findPattern(query);
    if (!pattern) return [];
    const matches: FindMatch[] = [];
    rows.forEach((row, index) => {
        if (row.kind !== 'line' || row.line.kind === 'note') return;
        for (const found of row.line.text.matchAll(pattern)) {
            matches.push({ row: index, start: found.index, end: found.index + found[0].length });
        }
    });
    return matches;
}

/**
 * The match to start on: the first on line `line` of the file now, or after it; the first when
 * none is (a removed line has no number now, and is passed over).
 */
export function matchFrom(
    matches: readonly FindMatch[],
    rows: readonly DiffRow[],
    line: number | null,
): number {
    if (line === null) return 0;
    const at = matches.findIndex((match) => {
        const row = rows[match.row];
        return row?.kind === 'line' && row.line.newNumber !== null && row.line.newNumber >= line;
    });
    return Math.max(at, 0);
}
