import { IconX } from '@tabler/icons-react';
import type { UseQueryResult } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { errorMessage } from '@/shared/errors/app-error';
import { commitDate, relativeTime, shortSha } from '../model/commits';
import type { Commit, CommitFiles, FileChange } from '../model/repository.types';
import { FILE_ROW_HEIGHT, FileRow } from './FileRow';
import { useVirtualRows } from './use-virtual-rows';
import { VirtualItems } from './VirtualItems';

const LIST_PADDING = 8;

function Note({ danger = false, children }: { danger?: boolean; children: ReactNode }) {
    return (
        <p className={`px-4 py-1.5 text-xs ${danger ? 'text-ui-danger' : 'text-ui-text-muted'}`}>
            {children}
        </p>
    );
}

/**
 * The files of a commit, in the place of the working tree's and on a tinted background, so it is
 * clear at a glance that they are not the current changes. On top, the commit as a card, whose ×
 * goes back to the working tree, as `Esc` does.
 */
export function CommitFileList({
    commit,
    files,
    selectedPath,
    onSelect,
    onBack,
}: {
    commit: Commit;
    files: UseQueryResult<CommitFiles | null>;
    selectedPath: string | null;
    onSelect: (file: FileChange) => void;
    onBack: () => void;
}) {
    const list = files.data?.files ?? [];
    // the commit's age is reckoned from when it was opened
    const [openedAt] = useState(() => Date.now() / 1000);
    const { scrollRef, virtualizer } = useVirtualRows<HTMLElement>({
        count: list.length,
        size: () => FILE_ROW_HEIGHT,
        padding: LIST_PADDING,
        selectedIndex: list.findIndex((file) => file.path === selectedPath),
    });

    return (
        // on the tint, the open file takes a deeper shade than its usual one
        <div className="flex h-full flex-col bg-ui-accent-tint [&_[aria-current]]:bg-ui-accent-soft-hover">
            <div className="flex shrink-0 items-start gap-2 border-b border-ui-border py-2 pr-2 pl-4">
                <div className="min-w-0 flex-1">
                    <p
                        className="flex items-center gap-1.5 text-[11px] text-ui-text-muted"
                        title={commitDate(commit)}
                    >
                        <span className="shrink-0 font-mono text-ui-accent-text">
                            {shortSha(commit.sha)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="min-w-0 truncate">{commit.author}</span>
                        <span aria-hidden="true">·</span>
                        <span className="shrink-0 font-mono tabular-nums">
                            {relativeTime(commit.time, openedAt)}
                        </span>
                    </p>
                    <p
                        className="mt-0.5 line-clamp-2 text-[13px] font-medium text-ui-text-secondary"
                        title={commit.subject}
                    >
                        {commit.subject}
                    </p>
                </div>
                <button
                    type="button"
                    className="btn-icon h-6 w-6"
                    title="Back to the working tree (Esc)"
                    aria-label="Back to the working tree"
                    onClick={onBack}
                >
                    <IconX size={14} />
                </button>
            </div>
            <nav
                ref={scrollRef}
                aria-label={`Files of commit ${shortSha(commit.sha)}`}
                className="min-h-0 flex-1 overflow-y-auto"
            >
                {files.isPending ? <Note>Loading…</Note> : null}
                {files.isError ? <Note danger>{errorMessage(files.error)}</Note> : null}
                {files.isSuccess && list.length === 0 ? <Note>No file changes.</Note> : null}
                <VirtualItems virtualizer={virtualizer}>
                    {(index) => {
                        const file = list[index];
                        return file ? (
                            <FileRow
                                file={file}
                                selected={file.path === selectedPath}
                                onSelect={() => onSelect(file)}
                            />
                        ) : null;
                    }}
                </VirtualItems>
                {files.data?.truncated ? (
                    <Note>Only the first {list.length.toLocaleString('en')} files are listed.</Note>
                ) : null}
            </nav>
        </div>
    );
}
