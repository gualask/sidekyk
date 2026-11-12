import { useMemo, useState } from 'react';
import type { FileFinder } from '../../../application/find';
import type { DiffRow } from '../../../model/diff/diff-rows';
import { type FindMatch, findMatches, matchFrom } from '../../../model/text/find';

/**
 * The match being read, among those of one text; its line, for the next text to start from; and
 * the line the bar was asked to start from, which a new ask moves to.
 */
interface Reading {
    matches: readonly FindMatch[];
    index: number;
    line: number | null;
    asked: number | null;
}

/** The number in the file now of the line a match is on. */
function lineOf(rows: readonly DiffRow[], match: FindMatch | undefined): number | null {
    const row = match ? rows[match.row] : undefined;
    return row?.kind === 'line' ? row.line.newNumber : null;
}

/**
 * The matches in `rows` of the text the find bar looks for (`find`, null while closed), and the
 * one being read. A new text, or the file read again, starts from the line of the match being
 * read, the first time from the line asked for.
 */
export function useFindReading(find: FileFinder['bar'], rows: readonly DiffRow[]) {
    const query = find?.query ?? '';
    const matches = useMemo(() => findMatches(rows, query), [rows, query]);
    const [reading, setReading] = useState<Reading | null>(null);
    let index = reading?.index ?? 0;
    if (!find) {
        if (reading) setReading(null);
    } else if (reading?.matches !== matches || reading.asked !== find.line) {
        const line = reading?.asked === find.line ? reading.line : find.line;
        index = matchFrom(matches, rows, line);
        const at = lineOf(rows, matches[index]) ?? line;
        setReading({ matches, index, line: at, asked: find.line });
    }
    /** Goes to the next match (`1`) or the previous one, round the ends. */
    const stepMatch = (by: -1 | 1) => {
        if (!find || matches.length === 0) return;
        const next = (index + by + matches.length) % matches.length;
        setReading({ matches, index: next, line: lineOf(rows, matches[next]), asked: find.line });
    };
    return { matches, index, stepMatch };
}
