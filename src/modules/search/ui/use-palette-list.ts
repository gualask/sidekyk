import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef } from 'react';
import type { Translator } from '@/shared/i18n';
import { useContentSearch } from '../application/content-search';
import { useSearch } from '../application/search.queries';
import {
    contentRows,
    type PaletteBook,
    type PalettePanel,
    type PaletteRow,
    paletteRows,
} from '../model/palette-rows';

const ROW_HEIGHT = { group: 28, item: 34, more: 30, file: 28 } as const;
/** A project: its name, and its folder under it. */
const PROJECT_HEIGHT = 46;
/** A line found in a file: lower than a place to go, many come at once. */
const LINE_HEIGHT = 28;

/**
 * What the list holds: the places found by name, ranked in the backend, or the lines found in
 * the files of `filesOf`, the current file's first.
 */
export function usePaletteRows({
    query,
    contents,
    filesOf,
    projectId,
    projectName,
    currentFile,
    panels,
    books,
    i18n,
}: {
    query: string;
    contents: boolean;
    filesOf: string | null;
    projectId: string | null;
    projectName: string | null;
    currentFile: string | null;
    panels: readonly PalettePanel[];
    books: (book: string) => PaletteBook;
    i18n: Translator;
}) {
    const titles = useMemo(() => panels.map((panel) => panel.title), [panels]);
    const names = useSearch(query, titles, projectId, !contents);
    const found = useContentSearch(contents ? filesOf : null, query);
    const { items, rows } = useMemo(() => {
        if (contents)
            return found ? contentRows(found.files, currentFile, i18n) : { items: [], rows: [] };
        // typed or not as the query the matches on screen answer, not the one still coming
        const shown = names.data;
        // inside a project, every list and note found is its own
        const rowBooks = projectId ? null : books;
        return shown
            ? paletteRows(
                  shown.results,
                  panels,
                  projectName,
                  shown.query.trim() !== '',
                  rowBooks,
                  i18n,
              )
            : { items: [], rows: [] };
    }, [contents, found, currentFile, names.data, panels, projectName, projectId, books, i18n]);
    return { names: names.data, found, items, rows };
}

/** The list's scrolled box and its virtualizer: only the rows on screen render. */
export function usePaletteVirtualizer(rows: readonly PaletteRow[]) {
    const scroller = useRef<HTMLDivElement>(null);
    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => scroller.current,
        estimateSize: (index) => rowHeight(rows[index]),
        overscan: 8,
        paddingStart: 6,
        paddingEnd: 6,
    });
    return { scroller, virtualizer };
}

/** A row's height before it renders: a project has its folder under it, a line found is lower. */
function rowHeight(row: PaletteRow): number {
    if (row.kind !== 'item') return ROW_HEIGHT[row.kind];
    if (row.item.kind === 'project') return PROJECT_HEIGHT;
    return row.item.kind === 'line' ? LINE_HEIGHT : ROW_HEIGHT.item;
}
