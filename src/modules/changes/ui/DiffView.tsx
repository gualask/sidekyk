import { IconCheck, IconCopy, IconFileOff } from '@tabler/icons-react';
import { type ReactNode, useMemo } from 'react';
import { errorMessage } from '@/shared/errors/app-error';
import { useCopyToClipboard } from '@/shared/ui/hooks/use-copy-to-clipboard';
import { useFileDiff } from '../application/repository.queries';
import { formatFileForAgent, formatHunkForAgent } from '../model/agent-snippet';
import { parseUnifiedDiff } from '../model/diff-parser';
import type { ChangeArea, ChangedFile } from '../model/repository.types';
import { HunkBlock } from './HunkBlock';
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
    const { copied, copy } = useCopyToClipboard();
    const hunks = parsed?.hunks ?? [];
    const fileCopied = copied?.id === 'file' ? copied : null;

    return (
        <div className="min-w-max">
            <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-ui-border bg-ui-surface px-4 py-2.5">
                <div className="min-w-0 font-mono text-[13px]">
                    {file.origPath ? (
                        <span className="text-ui-text-muted">{file.origPath} → </span>
                    ) : null}
                    <span className="font-semibold">{file.path}</span>
                </div>
                <span className="chip shrink-0">{AREA_LABEL[file.area]}</span>
                <span className="shrink-0 text-xs">
                    <LineCounts additions={file.additions} deletions={file.deletions} />
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

            {hunks.map((hunk, index) => {
                const id = `hunk-${index}`;
                return (
                    <HunkBlock
                        key={hunk.header + String(index)}
                        hunk={hunk}
                        copied={copied?.id === id ? copied : null}
                        onCopy={() => void copy(id, formatHunkForAgent(file.path, hunk))}
                    />
                );
            })}

            {diff.data?.truncated ? (
                <Notice>The diff is too large and was cut. Open the file to see the rest.</Notice>
            ) : null}
        </div>
    );
}
