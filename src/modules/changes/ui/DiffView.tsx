import { IconCheck, IconCopy, IconFileOff } from '@tabler/icons-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { type ReactNode, type RefObject, useMemo, useRef } from 'react';
import { errorMessage } from '@/shared/errors/app-error';
import { useCopyToClipboard } from '@/shared/ui/hooks/use-copy-to-clipboard';
import { useFileDiff } from '../application/repository.queries';
import { formatFileForAgent, formatHunkForAgent } from '../model/agent-snippet';
import { type DiffHunk, parseUnifiedDiff } from '../model/diff-parser';
import { diffRows, widestLine } from '../model/diff-rows';
import type { ChangeArea, ChangedFile } from '../model/repository.types';
import { DiffLineRow, HunkHeaderRow } from './DiffRows';
import { HUNK_ROW_HEIGHT, LINE_CHROME_WIDTH, LINE_ROW_HEIGHT } from './diff-layout';
import { LineCounts } from './LineCounts';

const AREA_LABEL: Record<ChangeArea, string> = {
    unstaged: 'Not staged',
    untracked: 'New file',
    staged: 'Staged',
};

function Notice({ children }: { children: ReactNode }) {
    return (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-ui-text-muted">
            {children}
        </div>
    );
}

/**
 * Every hunk as one virtualized list: only the rows on screen are in the DOM, so a diff of tens
 * of thousands of lines scrolls like a short one.
 */
function DiffLines({
    path,
    hunks,
    scrollRef,
}: {
    path: string;
    hunks: readonly DiffHunk[];
    scrollRef: RefObject<HTMLDivElement | null>;
}) {
    const rows = useMemo(() => diffRows(hunks), [hunks]);
    const widest = useMemo(() => widestLine(hunks), [hunks]);
    const { copied, copy } = useCopyToClipboard();
    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: (index) => (rows[index]?.kind === 'hunk' ? HUNK_ROW_HEIGHT : LINE_ROW_HEIGHT),
        overscan: 30,
    });

    return (
        <div
            className="relative border-b border-ui-border bg-ui-surface font-mono text-xs"
            style={{
                height: virtualizer.getTotalSize(),
                minWidth: `calc(${LINE_CHROME_WIDTH}px + ${widest}ch)`,
            }}
        >
            {virtualizer.getVirtualItems().map((item) => {
                const row = rows[item.index];
                if (!row) return null;
                const id = `hunk-${row.hunkIndex}`;
                return (
                    <div
                        key={item.key}
                        className="absolute top-0 left-0 w-full"
                        style={{ transform: `translateY(${item.start}px)` }}
                    >
                        {row.kind === 'hunk' ? (
                            <HunkHeaderRow
                                hunk={row.hunk}
                                first={row.hunkIndex === 0}
                                copied={copied?.id === id ? copied : null}
                                onCopy={() => void copy(id, formatHunkForAgent(path, row.hunk))}
                            />
                        ) : (
                            <DiffLineRow line={row.line} />
                        )}
                    </div>
                );
            })}
        </div>
    );
}

export function DiffView({ root, file }: { root: string; file: ChangedFile }) {
    const diff = useFileDiff(root, {
        path: file.path,
        origPath: file.origPath,
        area: file.area,
    });
    const parsed = useMemo(
        () => (diff.data ? parseUnifiedDiff(diff.data.text) : null),
        [diff.data],
    );
    const scrollRef = useRef<HTMLDivElement>(null);
    const { copied, copy } = useCopyToClipboard();
    const hunks = parsed?.hunks ?? [];
    const fileCopied = copied?.id === 'file' ? copied : null;

    return (
        <div className="flex h-full flex-col">
            <div className="flex shrink-0 items-center gap-3 border-b border-ui-border bg-ui-surface px-4 py-2.5">
                <div className="min-w-0 truncate font-mono text-[13px]">
                    {file.origPath ? (
                        <span className="text-ui-text-muted">{file.origPath} → </span>
                    ) : null}
                    <span className="font-semibold">{file.path}</span>
                </div>
                <span className="chip shrink-0">{AREA_LABEL[file.area]}</span>
                <span className="shrink-0 text-xs">
                    <LineCounts
                        additions={file.additions}
                        deletions={file.deletions}
                        binary={file.binary}
                    />
                </span>
                <button
                    type="button"
                    className="btn-ghost-sm ml-auto shrink-0"
                    disabled={hunks.length === 0}
                    title="Copy every hunk of this file, ready to paste to your agent"
                    onClick={() => void copy('file', formatFileForAgent(file.path, hunks))}
                >
                    {fileCopied?.ok ? <IconCheck size={14} /> : <IconCopy size={14} />}
                    {fileCopied ? (fileCopied.ok ? 'Copied' : 'Copy failed') : 'Copy file'}
                </button>
            </div>

            <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
                {hunks.length > 0 ? (
                    <DiffLines path={file.path} hunks={hunks} scrollRef={scrollRef} />
                ) : null}

                {diff.isPending ? <Notice>Loading diff…</Notice> : null}
                {diff.isError ? (
                    <Notice>
                        <span className="text-ui-danger">{errorMessage(diff.error)}</span>
                    </Notice>
                ) : null}
                {parsed?.binary ? (
                    <Notice>
                        <IconFileOff size={28} stroke={1.5} />
                        Binary file, no text to show.
                    </Notice>
                ) : null}
                {parsed && !parsed.binary && hunks.length === 0 ? (
                    <Notice>No line changes (only mode or metadata changed).</Notice>
                ) : null}
                {diff.data?.truncated ? (
                    <Notice>
                        The diff is too large and was cut. Open the file to see the rest.
                    </Notice>
                ) : null}
            </div>
        </div>
    );
}
