import { type ReactNode, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { errorMessage } from '@/shared/errors/app-error';
import { useTranslation } from '@/shared/i18n';
import type { FileFinder } from '../../../application/find';
import { useRepositorySettings } from '../../../application/repository-settings';
import type { CopySource } from '../../../model/diff/copied';
import type { DiffHunk } from '../../../model/diff/diff-parser';
import { type DiffRow, rowsOfLines } from '../../../model/diff/diff-rows';
import type { FileLines } from '../../../model/targets';
import type { FileSyntax } from '../../../model/text/syntax';
import { diffLayout, FIND_BAR_SPACE } from '../diff/diff-layout';
import { DiffList } from '../diff/diff-list/DiffList';
import type { HunkReader } from '../diff/diff-list/use-hunk-reader';
import { ChangeMap, SideScrollbar } from '../diff/ScrollMap';
import { FindBar } from '../FindBar';
import { useScrollbars } from '../scrollbars';
import { useLineWrapper } from '../text/code-wrap';
import { type PaneHeader, usePaneHeader } from './pane-header';
import { useFindReading } from './use-find-reading';
import { usePaneKeys } from './use-pane-keys';

/** A read that failed, as a notice says it. */
export function ErrorText({ error }: { error: unknown }) {
    const i18n = useTranslation();
    return <span className="text-ui-danger">{errorMessage(error, i18n)}</span>;
}

/** What the viewer says instead of, or after, the lines: loading, a failure, a cut. */
export function Notice({ children }: { children: ReactNode }) {
    return (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-ui-text-muted">
            {children}
        </div>
    );
}

/** The hunk a viewer opens on, as an index: null opens on the first, unmarked. */
function openedOn(openOn: number | null, count: number): number | null {
    if (openOn === null || count === 0) return null;
    return openOn < 0 ? Math.max(0, count + openOn) : Math.min(openOn, count - 1);
}

/** The row of a file's line: the first at or past it; null for none. */
function rowOfLine(rows: readonly DiffRow[], line: number | null): number | null {
    if (line === null) return null;
    const index = rows.findIndex((row) => row.kind === 'line' && (row.line.newNumber ?? 0) >= line);
    return index < 0 ? null : index;
}

/**
 * The viewer, the same for a diff, a whole file with its changes and a file's text: its rows, of
 * which only those on screen render, then what it has to say (`children`), and in the panel's
 * header what `renderHeader` puts there. `⌘F` opens a bar over the rows that goes through a text
 * in the file, from its top; `⌘F` again, in the bar, looks for it in all the project's files.
 * `Esc` closes the bar before anything else. With `onPastEnd`, `n`/`p` go to the next or previous
 * change. Long lines scroll sideways or wrap at the viewer's width, as the settings say.
 */
export function Pane({
    header,
    renderHeader,
    source,
    rows,
    hunks,
    widest,
    openOn,
    openOnLine = null,
    marked = null,
    linesAbove,
    finder,
    syntax,
    onPastEnd,
    banner = null,
    children,
}: {
    /** The panel's header, where the open file goes (see `PanelProps`). */
    header: HTMLElement | null;
    renderHeader: (pane: PaneHeader) => ReactNode;
    /** What a copy's `{row}` names. */
    source: CopySource;
    rows: readonly DiffRow[];
    hunks: readonly DiffHunk[];
    /** The widest line, in monospace columns. */
    widest: number;
    /** The hunk to open on; the first if null. */
    openOn: number | null;
    /** A file's line to open on instead, its preview's place. */
    openOnLine?: number | null;
    /** A file's lines marked, by their numbers now: those a note names. */
    marked?: FileLines | null;
    /** Lines left above that hunk, so it shows where it sits. */
    linesAbove: number;
    finder: FileFinder;
    /** What the lines are colored from. */
    syntax: FileSyntax;
    /**
     * `n`/`p` go through the changes, and past the last or the first go on here (the next or
     * previous file); without it, the pane takes no `n`/`p`.
     */
    onPastEnd?: (step: 1 | -1) => void;
    /** What stays above the rows, across the viewer, while they scroll. */
    banner?: ReactNode;
    children: ReactNode;
}) {
    const { scrollbar, codeLines } = useRepositorySettings();
    // state, not a ref: React attaches a parent's ref after its children's effects, so lines
    // mounted with it, from a file already read, would find no element to scroll
    const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
    const wrapper = useLineWrapper(scrollElement, rows, codeLines === 'wrap');
    const layout = useMemo(() => diffLayout(rows, wrapper?.rowsOf), [rows, wrapper]);
    // the hunk gone to (`n`/`p`, a mark of the map), else the one opened on
    const [stepped, setStepped] = useState<number | null>(null);
    const current = stepped ?? openedOn(openOn, hunks.length);
    const bars = useScrollbars(scrollElement);
    const reader = useRef<HunkReader | null>(null);
    const [uncolored, setUncolored] = useState(false);
    const find = finder.bar;
    const pane = usePaneHeader({
        source,
        rows,
        hunks,
        layout,
        scrollElement,
        reader,
        uncolored,
        findBar: find,
    });
    const { matches, index, stepMatch } = useFindReading(find, rows);
    const field = useRef<HTMLInputElement>(null);
    usePaneKeys({ finder, field, reader, onPastEnd });

    const topSpace = find ? FIND_BAR_SPACE : 0;
    const openOnRow = useMemo(() => rowOfLine(rows, openOnLine), [rows, openOnLine]);
    const markedRows = useMemo(() => (marked ? rowsOfLines(rows, marked) : null), [rows, marked]);
    return (
        <div className="flex h-full flex-col">
            {header ? createPortal(renderHeader(pane), header) : null}
            {banner}
            <div className="flex min-h-0 flex-1">
                <div className="relative flex min-w-0 flex-1 flex-col">
                    {find ? (
                        <FindBar
                            field={field}
                            query={find.query}
                            count={matches.length}
                            current={index}
                            onQuery={find.onQuery}
                            onStep={stepMatch}
                            onClose={find.onClose}
                            onFindInFiles={() => finder.findInFiles(find.query)}
                        />
                    ) : null}
                    {/* the list keeps its rows in place itself as the room above it changes: no
                    browser scroll anchoring (Chromium's) on top of it. Its own scrollbars are the
                    map beside it and the bar below; wrapped lines never scroll sideways */}
                    <div
                        ref={setScrollElement}
                        className={`min-h-0 flex-1 overflow-y-auto [overflow-anchor:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
                            wrapper ? 'overflow-x-hidden' : 'overflow-x-auto'
                        }`}
                    >
                        {scrollElement && rows.length > 0 ? (
                            <DiffList
                                source={source}
                                rows={rows}
                                layout={layout}
                                hunks={hunks}
                                widest={widest}
                                scrollElement={scrollElement}
                                openOn={openOn}
                                openOnRow={openOnRow}
                                marked={markedRows}
                                linesAbove={linesAbove}
                                reader={reader}
                                current={current}
                                onCurrent={setStepped}
                                found={
                                    find && matches.length > 0 ? { matches, current: index } : null
                                }
                                topSpace={topSpace}
                                syntax={syntax}
                                onTooLarge={setUncolored}
                                wrapper={wrapper}
                            />
                        ) : null}
                        {children}
                    </div>
                    {scrollElement && bars.wide ? (
                        <SideScrollbar scrollElement={scrollElement} thumb={bars.horizontal} />
                    ) : null}
                </div>
                {scrollElement ? (
                    <ChangeMap
                        scrollElement={scrollElement}
                        thumb={bars.vertical}
                        contentHeight={bars.height}
                        layout={layout}
                        rows={rows}
                        topSpace={topSpace}
                        width={scrollbar}
                        onGoTo={(hunk) => reader.current?.goTo(hunk)}
                    />
                ) : null}
            </div>
        </div>
    );
}
