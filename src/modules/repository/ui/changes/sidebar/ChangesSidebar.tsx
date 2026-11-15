import { type ReactNode, useRef } from 'react';
import { SidebarSplitter } from '@/shared/ui/SidebarSplitter';
import { useSidebarWidth } from '@/shared/ui/sidebar-width';
import type { useCommitView } from '../../../application/commit-view';
import type { ChangedFile } from '../../../model/repository.types';
import { CommitFileList } from './CommitFileList';
import { FileList } from './FileList';
import { fittingRowsWidth } from './list-layout';

/** The list's width by default, the same in a tile and full screen, and the least it takes. */
const LIST_WIDTH = { initial: 288, min: 200 };

/**
 * The panel's list, at the width dragged: the working tree's changed files, or the files of the
 * commit viewed, and below them the recent commits when they are kept there.
 */
export function ChangesSidebar({
    commitView,
    files,
    selectedKey,
    onSelect,
    commits,
}: {
    commitView: ReturnType<typeof useCommitView>;
    /** The working tree's changed files. */
    files: readonly ChangedFile[];
    selectedKey: string | null;
    onSelect: (file: ChangedFile) => void;
    /** The recent commits, at the bottom of the list; null when they are under the whole panel. */
    commits: ReactNode;
}) {
    const viewed = commitView.commit;
    const listWidth = useSidebarWidth('changes', LIST_WIDTH);
    const listBox = useRef<HTMLElement>(null);

    return (
        <>
            <aside
                ref={listBox}
                className="flex shrink-0 flex-col border-r border-ui-border bg-ui-surface"
                style={listWidth.style}
            >
                <div className="min-h-0 flex-1">
                    {viewed ? (
                        <CommitFileList
                            commit={viewed}
                            files={commitView.files}
                            selectedPath={commitView.file?.path ?? null}
                            onSelect={commitView.open}
                            onBack={commitView.leave}
                        />
                    ) : (
                        <FileList files={files} selectedKey={selectedKey} onSelect={onSelect} />
                    )}
                </div>
                {commits}
            </aside>
            <SidebarSplitter
                width={listWidth}
                box={listBox}
                place="edge"
                fitting={(box) =>
                    fittingRowsWidth(viewed ? (commitView.files.data?.files ?? []) : files, box)
                }
                what="list"
            />
        </>
    );
}
