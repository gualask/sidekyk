import { useVirtualizer } from '@tanstack/react-virtual';
import { type RefObject, useEffect, useRef } from 'react';
import { useSyntaxColors } from '../../../../application/queries/syntax-colors';
import type { CopySource } from '../../../../model/diff/copied';
import type { DiffHunk, DiffLine } from '../../../../model/diff/diff-parser';
import type { DiffRow } from '../../../../model/diff/diff-rows';
import type { FindMatch } from '../../../../model/text/find';
import type { LineWrapper } from '../../../../model/text/soft-wrap/wrap';
import { blocksOf, type FileSyntax } from '../../../../model/text/syntax';
import {
    CODE_TEXT,
    type DiffLayout,
    heightOf,
    hunksBetween,
    LINE_CHROME_WIDTH,
    openingOffset,
    type Span,
    spanBox,
} from '../diff-layout';
import { targetSpan } from '../diff-target';
import { CopyFlash, HunkBrackets } from './DiffOverlays';
import { DiffLineRow, HunkHeaderRow } from './DiffRows';
import { useFoundRows } from './use-found-rows';
import { type HunkReader, useHunkReader } from './use-hunk-reader';
import { useRowCopy } from './use-row-copy';
import { useScrollKept } from './use-scroll-kept';

/**
 * A diff's rows as one virtualized list, the same in both views: only the rows on screen are in
 * the DOM. Everything copies with a click, through the user's template: a line, or a hunk from
 * its lines' numbers or its header; text selected with the mouse copies itself, exactly, when
 * the button comes up. What a click would copy lights up under the pointer, and once copied
 * flashes and says what it was at its top right.
 *
 * It opens on hunk `openOn` (the first if null, counted from the end if negative), `linesAbove`
 * lines above it; `reader` tells which hunk is being read meanwhile, as many lines below the top,
 * for the other view to open on, and steps to the next or previous one (`n`/`p`).
 * `found` marks the text looked for, and brings the match being read on screen. `topSpace` leaves
 * room above the first row, under the find bar floating over the list, as VS Code does. The lines
 * on screen take the colors of `syntax`, read a block at a time; `onTooLarge` says when a version
 * is too large to color. With `wrapper`, long lines wrap where it says, as `layout` placed them.
 */
export function DiffList({
    source,
    rows,
    layout,
    hunks,
    widest,
    scrollElement,
    openOn,
    openOnRow = null,
    marked = null,
    linesAbove,
    reader,
    current,
    onCurrent,
    found,
    topSpace,
    syntax,
    onTooLarge,
    wrapper,
}: {
    source: CopySource;
    rows: readonly DiffRow[];
    /** Where the rows are (`diffLayout`), which the viewer's map shares. */
    layout: DiffLayout;
    hunks: readonly DiffHunk[];
    /** The widest line, in monospace columns. */
    widest: number;
    scrollElement: HTMLDivElement;
    openOn: number | null;
    /** A row to open on instead, at the top: a file's line its preview was read at. */
    openOnRow?: number | null;
    /** Rows marked, as long as they are asked for: the lines a note names. */
    marked?: Span | null;
    linesAbove: number;
    reader: RefObject<HunkReader | null>;
    /** The hunk gone to (`n`/`p`, the map, the one opened on): where the next step starts. */
    current: number | null;
    onCurrent: (hunk: number) => void;
    found: { matches: readonly FindMatch[]; current: number } | null;
    /** Room above the first row, in pixels: none without the find bar. */
    topSpace: number;
    syntax: FileSyntax;
    onTooLarge: (tooLarge: boolean) => void;
    /** Where long lines wrap; null while they scroll sideways. */
    wrapper: LineWrapper | null;
}) {
    const listRef = useRef<HTMLDivElement>(null);
    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => scrollElement,
        estimateSize: (index) => heightOf(layout, index),
        overscan: 30,
        // the rows start below the room left above them
        scrollMargin: topSpace,
        // read once, when the list first shows: a refresh of the same file keeps the scroll
        initialOffset: () =>
            openOnRow === null
                ? openingOffset(layout, openOn, linesAbove)
                : (layout.starts[openOnRow] ?? 0),
    });
    useHunkReader({
        reader,
        scrollElement,
        layout,
        rows,
        linesAbove,
        topSpace,
        current,
        onCurrent,
    });
    useScrollKept({ scrollElement, layout, rows, topSpace, virtualizer });
    const lineFound = useFoundRows({ found, scrollElement, layout, topSpace, wrapper });
    const { copied, flash, copyTarget, hovered } = useRowCopy({
        listRef,
        scrollElement,
        source,
        rows,
        hunks,
        layout,
    });

    const hoveredSpan = hovered ? targetSpan(layout, hovered) : undefined;
    const hoveredHunk = hovered?.kind === 'hunk' ? hovered.hunk : -1;
    const items = virtualizer.getVirtualItems();
    const shownLines = items.flatMap((item): DiffLine[] => {
        const row = rows[item.index];
        return row?.kind === 'line' ? [row.line] : [];
    });
    const colors = useSyntaxColors(
        syntax.folderId,
        syntax.sides,
        blocksOf(shownLines, syntax.sides),
    );
    useEffect(() => onTooLarge(colors.tooLarge), [colors.tooLarge, onTooLarge]);
    const brackets = hunksBetween(layout, rows, items[0]?.index ?? 0, items.at(-1)?.index ?? -1);

    // wrapped, the rows are as wide as the list; otherwise as the widest line
    const minWidth = wrapper ? undefined : `calc(${LINE_CHROME_WIDTH}px + ${widest}ch)`;
    return (
        <>
            {topSpace > 0 ? (
                <div aria-hidden className="bg-ui-surface" style={{ height: topSpace, minWidth }} />
            ) : null}
            <div
                ref={listRef}
                className={`relative border-b border-ui-border bg-ui-surface ${CODE_TEXT}`}
                style={{
                    height: layout.total,
                    minWidth,
                }}
            >
                {items.map((item) => {
                    const row = rows[item.index];
                    if (!row) return null;
                    return (
                        <div
                            key={item.key}
                            data-row={item.index}
                            className="absolute top-0 left-0 w-full"
                            style={{ transform: `translateY(${item.start - topSpace}px)` }}
                        >
                            {row.kind === 'hunk' ? (
                                <HunkHeaderRow
                                    hunk={row.hunk}
                                    first={row.hunkIndex === 0}
                                    onCopy={() => copyTarget({ kind: 'hunk', hunk: row.hunkIndex })}
                                />
                            ) : (
                                <DiffLineRow
                                    line={row.line}
                                    colors={colors.colorsOf(row.line)}
                                    found={lineFound(item.index)}
                                    wrap={wrapper?.breaksOf(item.index)}
                                />
                            )}
                        </div>
                    );
                })}
                <HunkBrackets layout={layout} brackets={brackets} hovered={hoveredHunk} />
                {marked ? (
                    <div
                        aria-hidden
                        className="pointer-events-none absolute left-0 w-full border-l-2 border-ui-accent bg-ui-accent/10"
                        style={spanBox(layout, marked)}
                    />
                ) : null}
                {hoveredSpan ? (
                    // as a button would: what a click copies, lightly
                    <div
                        aria-hidden
                        className={`pointer-events-none absolute left-0 w-full ring-1 ring-inset ${
                            hovered?.kind === 'hunk'
                                ? 'bg-ui-accent/8 ring-ui-accent'
                                : 'bg-ui-accent/6 ring-ui-accent-muted/50'
                        }`}
                        style={spanBox(layout, hoveredSpan)}
                    />
                ) : null}
                <CopyFlash layout={layout} copied={copied} flash={flash} />
            </div>
        </>
    );
}
