import { type ReactNode, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type CopyState, useCopyToClipboard } from '@/shared/ui/hooks/use-copy-to-clipboard';
import { useWindowKeys } from '@/shared/ui/hooks/use-window-keys';
import { isOwnKey } from '@/shared/ui/keys';
import type { FindBarState } from '../application/find';
import { useRepositorySettings } from '../application/repository-settings';
import { type CopySource, fileText } from '../model/copied';
import type { DiffHunk } from '../model/diff-parser';
import type { DiffRow } from '../model/diff-rows';
import { type FindMatch, findMatches, matchFrom } from '../model/find';
import { DiffList } from './DiffList';
import { FindBar } from './FindBar';

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

/** The number in the file now of the line a match is on. */
function lineOf(rows: readonly DiffRow[], match: FindMatch | undefined): number | null {
    const row = match ? rows[match.row] : undefined;
    return row?.kind === 'line' ? row.line.newNumber : null;
}

/**
 * The viewer, the same for a diff, a whole file with its changes and a file's text: its rows, of
 * which only those on screen render, then what it has to say (`children`), and in the panel's
 * header what `renderHeader` puts there. With `find`, a bar over the rows goes through the text
 * looked for, `Esc` closing it before anything else.
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
    find = null,
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
    find?: FindBarState | null;
    children: ReactNode;
}) {
    const { copyTemplate } = useRepositorySettings();
    // state, not a ref: React attaches a parent's ref after its children's effects, so lines
    // mounted with it, from a file already read, would find no element to scroll
    const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
    const currentHunk = useRef<(() => number) | null>(null);
    const { copied, copy } = useCopyToClipboard();
    const pane = useMemo<PaneHeader>(
        () => ({
            copyFile:
                hunks.length > 0
                    ? () => void copy('file', fileText(copyTemplate, source, hunks))
                    : null,
            fileCopied: copied?.id === 'file' ? copied : null,
            currentHunk: () => currentHunk.current?.() ?? 0,
        }),
        [hunks, copy, copyTemplate, source, copied],
    );

    // the matches of the text looked for; a new text, or the file read again, starts from the
    // line of the match being read, the first time from the line asked for
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
    // `Esc` closes the bar first, wherever the focus is in the panel
    useWindowKeys(
        (event) => {
            if (!find || event.key !== 'Escape' || event.defaultPrevented || !isOwnKey(event)) {
                return;
            }
            event.preventDefault();
            find.onClose();
        },
        { capture: true },
    );

    return (
        <div className="flex h-full flex-col">
            {header ? createPortal(renderHeader(pane), header) : null}
            {find ? (
                <FindBar
                    query={find.query}
                    count={matches.length}
                    current={index}
                    onQuery={find.onQuery}
                    onStep={step}
                    onClose={find.onClose}
                />
            ) : null}
            <div ref={setScrollElement} className="min-h-0 flex-1 overflow-auto">
                {scrollElement && rows.length > 0 ? (
                    <DiffList
                        source={source}
                        rows={rows}
                        hunks={hunks}
                        widest={widest}
                        scrollElement={scrollElement}
                        openOn={openOn}
                        linesAbove={linesAbove}
                        currentHunk={currentHunk}
                        found={find && matches.length > 0 ? { matches, current: index } : null}
                    />
                ) : null}
                {children}
            </div>
        </div>
    );
}
