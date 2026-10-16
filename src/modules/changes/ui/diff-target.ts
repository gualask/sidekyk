import type { DiffRow } from '../model/diff-rows';
import type { DiffLayout, Span } from './diff-layout';

/** What a click copies: a line, or a whole hunk. */
export type Target = { kind: 'line'; row: number } | { kind: 'hunk'; hunk: number };

/**
 * What a click at row `row` copies: a hunk from its header, or from its lines' gutter; otherwise
 * the line. A line outside every hunk copies itself from its gutter too.
 */
export function targetAt(rows: readonly DiffRow[], row: number, inGutter: boolean): Target | null {
    const at = rows[row];
    if (!at) return null;
    if (at.kind === 'hunk') return { kind: 'hunk', hunk: at.hunkIndex };
    if (inGutter && at.hunkIndex >= 0) return { kind: 'hunk', hunk: at.hunkIndex };
    return { kind: 'line', row };
}

export function sameTarget(a: Target | null, b: Target | null): boolean {
    if (a?.kind === 'line' && b?.kind === 'line') return a.row === b.row;
    if (a?.kind === 'hunk' && b?.kind === 'hunk') return a.hunk === b.hunk;
    return a === b;
}

/** The rows a target takes: a hunk's header and lines, or its line. */
export function targetSpan(layout: DiffLayout, target: Target): Span | undefined {
    return target.kind === 'hunk'
        ? layout.hunks[target.hunk]
        : { first: target.row, last: target.row };
}
