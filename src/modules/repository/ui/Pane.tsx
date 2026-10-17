import { type ReactNode, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type CopyState, useCopyToClipboard } from '@/shared/ui/hooks/use-copy-to-clipboard';
import { useRepositorySettings } from '../application/repository-settings';
import { type CopySource, fileText } from '../model/copied';
import type { DiffHunk } from '../model/diff-parser';
import type { DiffRow } from '../model/diff-rows';
import { DiffList } from './DiffList';

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
 * The viewer, the same for a diff, a whole file with its changes and a file's text: its rows, of
 * which only those on screen render, then what it has to say (`children`), and in the panel's
 * header what `renderHeader` puts there.
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

    return (
        <div className="flex h-full flex-col">
            {header ? createPortal(renderHeader(pane), header) : null}
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
                    />
                ) : null}
                {children}
            </div>
        </div>
    );
}
