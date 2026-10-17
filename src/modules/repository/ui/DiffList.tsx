import { IconCheck, IconCopy, IconCopyOff } from '@tabler/icons-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useCopyToClipboard } from '@/shared/ui/hooks/use-copy-to-clipboard';
import { useRepositorySettings } from '../application/repository-settings';
import {
    type Copied,
    type CopySource,
    copiedLabel,
    copiedText,
    hunkCopied,
    lineCopied,
    selectionCopied,
} from '../model/copied';
import type { DiffHunk, DiffLine } from '../model/diff-parser';
import type { DiffRow } from '../model/diff-rows';
import type { FindMatch } from '../model/find';
import { DiffLineRow, HunkHeaderRow, type LineFound } from './DiffRows';
import {
    BRACKET_WIDTH,
    diffLayout,
    hunkFrom,
    hunksBetween,
    LINE_CHROME_WIDTH,
    LINE_ROW_HEIGHT,
    openingOffset,
    rowAt,
    rowHeight,
    rowWithin,
    type Span,
    spanBox,
} from './diff-layout';
import { type Target, targetSpan } from './diff-target';
import { useDiffPointer } from './use-diff-pointer';

/** A copy's confirmation: its rows, what it took, and how far the list runs right of the screen. */
type Flash = Span & { label: string; right: number; key: number };

/**
 * A diff's rows as one virtualized list, the same in both views: only the rows on screen are in
 * the DOM. Everything copies with a click, through the user's template: a line, or a hunk from
 * its lines' numbers or its header; text selected with the mouse copies itself, exactly, when
 * the button comes up. What a click would copy lights up under the pointer, and once copied
 * flashes and says what it was at its top right.
 *
 * It opens on hunk `openOn` (the first if null), `linesAbove` lines above it; `currentHunk` tells
 * which hunk is being read meanwhile, as many lines below the top, for the other view to open on.
 * `found` marks the text looked for, and brings the match being read on screen. `topSpace` leaves
 * room above the first row, under the find bar floating over the list, as VS Code does.
 */
export function DiffList({
    source,
    rows,
    hunks,
    widest,
    scrollElement,
    openOn,
    linesAbove,
    currentHunk,
    found,
    topSpace,
}: {
    source: CopySource;
    rows: readonly DiffRow[];
    hunks: readonly DiffHunk[];
    /** The widest line, in monospace columns. */
    widest: number;
    scrollElement: HTMLDivElement;
    openOn: number | null;
    linesAbove: number;
    currentHunk: RefObject<(() => number) | null>;
    found: { matches: readonly FindMatch[]; current: number } | null;
    /** Room above the first row, in pixels: none without the find bar. */
    topSpace: number;
}) {
    const { copyTemplate } = useRepositorySettings();
    const listRef = useRef<HTMLDivElement>(null);
    const layout = useMemo(() => diffLayout(rows), [rows]);
    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => scrollElement,
        estimateSize: (index) => rowHeight(rows[index]),
        overscan: 30,
        // the rows start below the room left above them
        scrollMargin: topSpace,
        // read once, when the list first shows: a refresh of the same file keeps the scroll
        initialOffset: () => openingOffset(layout, openOn, linesAbove),
    });

    useEffect(() => {
        currentHunk.current = () => {
            const top = Math.max(
                0,
                (virtualizer.scrollOffset ?? 0) - topSpace + linesAbove * LINE_ROW_HEIGHT,
            );
            return hunkFrom(layout, rows, rowAt(layout, top));
        };
        return () => {
            currentHunk.current = null;
        };
    }, [currentHunk, virtualizer, layout, rows, linesAbove, topSpace]);

    // the room above comes and goes without moving the rows on screen, but at the top, where it
    // shows
    const shownSpace = useRef(topSpace);
    useLayoutEffect(() => {
        const change = topSpace - shownSpace.current;
        shownSpace.current = topSpace;
        if (change !== 0 && scrollElement.scrollTop > 0) scrollElement.scrollTop += change;
    }, [topSpace, scrollElement]);

    // the text looked for, row by row, and the match being read, centred when it is off screen or
    // under the find bar
    const foundRows = useMemo(() => {
        const byRow = new Map<number, [number, number][]>();
        for (const { row, start, end } of found?.matches ?? []) {
            const ranges = byRow.get(row) ?? [];
            ranges.push([start, end]);
            byRow.set(row, ranges);
        }
        return byRow;
    }, [found?.matches]);
    const currentMatch = found ? found.matches[found.current] : undefined;
    useEffect(() => {
        if (!currentMatch) return;
        // in the list's offsets the screen starts `topSpace` above `scrollTop`, and the bar covers
        // that band
        const { scrollTop, clientHeight } = scrollElement;
        const bottom = scrollTop + clientHeight - topSpace;
        if (rowWithin(layout, rows, currentMatch.row, scrollTop, bottom)) return;
        virtualizer.scrollToIndex(currentMatch.row, { align: 'center' });
    }, [currentMatch, virtualizer, layout, rows, topSpace, scrollElement]);
    const lineFound = (index: number): LineFound | undefined => {
        const ranges = foundRows.get(index);
        if (!ranges) return undefined;
        const current =
            currentMatch?.row === index
                ? ranges.findIndex(([start]) => start === currentMatch.start)
                : null;
        return { ranges, current };
    };

    // what was copied flashes and says what it was, in the part of the list on screen; a new key
    // each time replays both
    const { copied, copy } = useCopyToClipboard();
    const [flash, setFlash] = useState<Flash | null>(null);
    const copyRows = (copiedValue: Copied, span: Span, label: string) => {
        const width = listRef.current?.offsetWidth ?? 0;
        const right = Math.max(0, width - scrollElement.scrollLeft - scrollElement.clientWidth);
        setFlash((current) => ({ ...span, label, right, key: (current?.key ?? 0) + 1 }));
        void copy('diff', copiedText(copyTemplate, copiedValue));
    };
    const copyTarget = (target: Target) => {
        const span = targetSpan(layout, target);
        const row = target.kind === 'line' ? rows[target.row] : undefined;
        const hunk = target.kind === 'hunk' ? hunks[target.hunk] : undefined;
        const copiedValue = hunk
            ? hunkCopied(source, hunk)
            : row?.kind === 'line'
              ? lineCopied(source, row.line)
              : null;
        if (span && copiedValue) copyRows(copiedValue, span, copiedLabel(copiedValue));
    };
    const hovered = useDiffPointer(listRef, rows, {
        click: copyTarget,
        select: (text, span) => {
            const lines = rows
                .slice(span.first, span.last + 1)
                .flatMap((row): DiffLine[] => (row.kind === 'line' ? [row.line] : []));
            copyRows(selectionCopied(source, lines, text), span, 'selection');
        },
    });

    const hoveredSpan = hovered ? targetSpan(layout, hovered) : undefined;
    const hoveredHunk = hovered?.kind === 'hunk' ? hovered.hunk : -1;
    const items = virtualizer.getVirtualItems();
    const brackets = hunksBetween(layout, rows, items[0]?.index ?? 0, items.at(-1)?.index ?? -1);

    const minWidth = `calc(${LINE_CHROME_WIDTH}px + ${widest}ch)`;
    return (
        <>
            {topSpace > 0 ? (
                <div aria-hidden className="bg-ui-surface" style={{ height: topSpace, minWidth }} />
            ) : null}
            <div
                ref={listRef}
                className="relative border-b border-ui-border bg-ui-surface font-mono text-xs"
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
                                <DiffLineRow line={row.line} found={lineFound(item.index)} />
                            )}
                        </div>
                    );
                })}
                {/* each hunk's lines held by a bracket in the gutter, a copy icon at its top: a click
                on the numbers copies the hunk. Only the hunks on screen */}
                {brackets.map(({ hunk, lines }) => (
                    <div
                        key={hunk}
                        aria-hidden
                        className={`pointer-events-none absolute left-0 ${
                            hunk === hoveredHunk
                                ? 'text-ui-accent'
                                : 'text-ui-text-muted opacity-50'
                        }`}
                        style={{ ...spanBox(layout, rows, lines), width: BRACKET_WIDTH }}
                    >
                        <IconCopy size={11} className="absolute top-[4.5px] left-[2.5px]" />
                        {lines.last > lines.first ? (
                            <span className="absolute top-[18px] bottom-1 left-[7.5px] w-1 rounded-bl-[2px] border-b border-l border-current" />
                        ) : null}
                    </div>
                ))}
                {hoveredSpan ? (
                    // as a button would: what a click copies, lightly
                    <div
                        aria-hidden
                        className={`pointer-events-none absolute left-0 w-full ring-1 ring-inset ${
                            hovered?.kind === 'hunk'
                                ? 'bg-ui-accent/8 ring-ui-accent'
                                : 'bg-ui-accent/6 ring-ui-accent-muted/50'
                        }`}
                        style={spanBox(layout, rows, hoveredSpan)}
                    />
                ) : null}
                <div role="status" className="contents">
                    {copied && flash ? (
                        <div key={flash.key} className="contents">
                            <div
                                aria-hidden
                                className={`pointer-events-none absolute left-0 w-full ${
                                    copied.ok ? 'copy-flash' : 'copy-flash-failed'
                                }`}
                                style={spanBox(layout, rows, flash)}
                            />
                            <span
                                className={`copied-chip pointer-events-none absolute z-10 mt-0.5 flex h-4 items-center gap-1 rounded px-1.5 font-sans text-[10.5px] font-semibold shadow-sm ${
                                    copied.ok
                                        ? 'bg-ui-accent-solid text-ui-accent-on-solid'
                                        : 'bg-ui-danger text-ui-accent-on-solid'
                                }`}
                                style={{
                                    top: layout.starts[flash.first] ?? 0,
                                    right: flash.right + 8,
                                }}
                            >
                                {copied.ok ? <IconCheck size={11} /> : <IconCopyOff size={11} />}
                                {copied.ok ? `Copied ${flash.label}` : 'Copy failed'}
                            </span>
                        </div>
                    ) : null}
                </div>
            </div>
        </>
    );
}
