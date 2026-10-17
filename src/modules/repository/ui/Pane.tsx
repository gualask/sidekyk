import { type ReactNode, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { shortcutKey } from '@/shared/platform/shortcut';
import { type CopyState, useCopyToClipboard } from '@/shared/ui/hooks/use-copy-to-clipboard';
import { useWindowKeys } from '@/shared/ui/hooks/use-window-keys';
import { isKeyTaken, isOwnKey } from '@/shared/ui/keys';
import type { FileFinder } from '../application/find';
import { useRepositorySettings } from '../application/repository-settings';
import { type CopySource, fileText } from '../model/copied';
import type { DiffHunk } from '../model/diff-parser';
import type { DiffRow } from '../model/diff-rows';
import { type FindMatch, findMatches, matchFrom } from '../model/find';
import { DiffList, type HunkReader } from './DiffList';
import { diffLayout, FIND_BAR_SPACE } from './diff-layout';
import { FindBar } from './FindBar';
import { ChangeMap, SideScrollbar } from './ScrollMap';

/** What the viewer says instead of, or after, the lines: loading, a failure, a cut. */
export function Notice({ children }: { children: ReactNode }) {
    return (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-ui-text-muted">
            {children}
        </div>
    );
}

/** What a pane gives the header of the panel it is in. */
export interface PaneHeader {
    /** The copy of the whole diff, hunk by hunk; null while there are no hunks to copy. */
    copyFile: (() => void) | null;
    fileCopied: CopyState;
    /** The hunk being read, for the other view, or the other panel, to open on. */
    currentHunk: () => number;
}

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

/** The hunk a viewer opens on, as an index: null opens on the first, unmarked. */
function openedOn(openOn: number | null, count: number): number | null {
    if (openOn === null || count === 0) return null;
    return openOn < 0 ? Math.max(0, count + openOn) : Math.min(openOn, count - 1);
}

/** The number in the file now of the line a match is on. */
function lineOf(rows: readonly DiffRow[], match: FindMatch | undefined): number | null {
    const row = match ? rows[match.row] : undefined;
    return row?.kind === 'line' ? row.line.newNumber : null;
}

/**
 * The viewer, the same for a diff, a whole file with its changes and a file's text: its rows, of
 * which only those on screen render, then what it has to say (`children`), and in the panel's
 * header what `renderHeader` puts there. `⌘F` opens a bar over the rows that goes through a text
 * in the file, from its top; `⌘F` again, in the bar, looks for it in all the project's files.
 * `Esc` closes the bar before anything else. With `onPastEnd`, `n`/`p` go to the next or previous
 * change.
 */
export function Pane({
    header,
    renderHeader,
    source,
    rows,
    hunks,
    widest,
    openOn,
    linesAbove,
    finder,
    onPastEnd,
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
    /** Lines left above that hunk, so it shows where it sits. */
    linesAbove: number;
    finder: FileFinder;
    /**
     * `n`/`p` go through the changes, and past the last or the first go on here (the next or
     * previous file); without it, the pane takes no `n`/`p`.
     */
    onPastEnd?: (step: 1 | -1) => void;
    children: ReactNode;
}) {
    const { copyTemplate, scrollbar } = useRepositorySettings();
    const layout = useMemo(() => diffLayout(rows), [rows]);
    // the hunk gone to (`n`/`p`, a mark of the map), else the one opened on
    const [stepped, setStepped] = useState<number | null>(null);
    const current = stepped ?? openedOn(openOn, hunks.length);
    // state, not a ref: React attaches a parent's ref after its children's effects, so lines
    // mounted with it, from a file already read, would find no element to scroll
    const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
    const reader = useRef<HunkReader | null>(null);
    const { copied, copy } = useCopyToClipboard();
    const pane = useMemo<PaneHeader>(
        () => ({
            copyFile:
                hunks.length > 0
                    ? () => void copy('file', fileText(copyTemplate, source, hunks))
                    : null,
            fileCopied: copied?.id === 'file' ? copied : null,
            currentHunk: () => reader.current?.current() ?? 0,
        }),
        [hunks, copy, copyTemplate, source, copied],
    );

    // the matches of the text looked for; a new text, or the file read again, starts from the
    // line of the match being read, the first time from the line asked for
    const find = finder.bar;
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
    const step = (by: -1 | 1) => {
        if (!find || matches.length === 0) return;
        const next = (index + by + matches.length) % matches.length;
        setReading({ matches, index: next, line: lineOf(rows, matches[next]), asked: find.line });
    };
    // before the workspace's keys: `⌘F` opens the bar, or comes back to it (in its field the bar
    // takes it); `Esc` closes the bar first, wherever the focus is in the panel
    const field = useRef<HTMLInputElement>(null);
    useWindowKeys(
        (event) => {
            if (event.defaultPrevented || isKeyTaken(event.target)) return;
            if (shortcutKey(event) === 'f') {
                event.preventDefault();
                if (find) {
                    field.current?.focus();
                    field.current?.select();
                } else finder.open();
                return;
            }
            if (!isOwnKey(event)) return;
            const step = event.key === 'n' ? 1 : event.key === 'p' ? -1 : 0;
            if (step !== 0 && onPastEnd) {
                event.preventDefault();
                if (!reader.current?.step(step)) onPastEnd(step);
                return;
            }
            if (!find || event.key !== 'Escape') return;
            event.preventDefault();
            find.onClose();
        },
        { capture: true },
    );

    const topSpace = find ? FIND_BAR_SPACE : 0;
    return (
        <div className="flex h-full">
            {header ? createPortal(renderHeader(pane), header) : null}
            <div className="relative flex min-w-0 flex-1 flex-col">
                {find ? (
                    <FindBar
                        field={field}
                        query={find.query}
                        count={matches.length}
                        current={index}
                        onQuery={find.onQuery}
                        onStep={step}
                        onClose={find.onClose}
                        onFindInFiles={() => finder.findInFiles(find.query)}
                    />
                ) : null}
                {/* the list keeps its rows in place itself as the room above it changes: no
                    browser scroll anchoring (Chromium's) on top of it. Its own scrollbars are the
                    map beside it and the bar below */}
                <div
                    ref={setScrollElement}
                    className="min-h-0 flex-1 overflow-auto [overflow-anchor:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
                            linesAbove={linesAbove}
                            reader={reader}
                            current={current}
                            onCurrent={setStepped}
                            found={find && matches.length > 0 ? { matches, current: index } : null}
                            topSpace={topSpace}
                        />
                    ) : null}
                    {children}
                </div>
                {scrollElement ? <SideScrollbar scrollElement={scrollElement} /> : null}
            </div>
            {scrollElement ? (
                <ChangeMap
                    scrollElement={scrollElement}
                    layout={layout}
                    rows={rows}
                    topSpace={topSpace}
                    width={scrollbar}
                    onGoTo={(hunk) => reader.current?.goTo(hunk)}
                />
            ) : null}
        </div>
    );
}
