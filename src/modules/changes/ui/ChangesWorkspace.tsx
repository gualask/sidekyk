import { IconCircleCheck } from '@tabler/icons-react';
import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import { errorMessage } from '@/shared/errors/app-error';
import type { PanelProps } from '@/shared/panels/panel';
import { isKeyTaken } from '@/shared/ui/keys';
import { useCommitView } from '../application/commit-view';
import { useRepositorySnapshot } from '../application/repository.queries';
import { fileKey, orderedFiles } from '../model/file-groups';
import { CommitFileList } from './CommitFileList';
import { ChangeDiffView, CommitDiffView } from './DiffView';
import { FileList } from './FileList';
import { RecentCommits } from './RecentCommits';

const NEXT_KEYS = new Set(['ArrowDown', 'j']);
const PREVIOUS_KEYS = new Set(['ArrowUp', 'k']);

/** Whether a key came with a modifier, or belongs to a field, a dialog or a menu. */
function isNotOurs(event: KeyboardEvent): boolean {
    return event.metaKey || event.ctrlKey || event.altKey || isKeyTaken(event.target);
}

/**
 * The Changes panel: what changed in the project's working tree, file by file, and below it the
 * recent commits. A commit clicked there shows its files in the list instead, until going back to
 * the working tree.
 */
export function ChangesWorkspace({ project, header, target }: PanelProps) {
    const snapshot = useRepositorySnapshot(project.root);
    const [selectedKey, setSelectedKey] = useState<string | null>(target?.key ?? null);
    const commitView = useCommitView(project.root);
    const { commit: viewed, file: commitFile } = commitView;

    // a file asked for from outside, such as the command palette (`changesTarget`)
    const showTarget = useEffectEvent((key: string) => {
        setSelectedKey(key);
        commitView.leave();
    });
    useEffect(() => {
        if (target) showTarget(target.key);
    }, [target]);

    const files = useMemo(() => orderedFiles(snapshot.data?.files ?? []), [snapshot.data]);
    // a file that left the list (committed, reverted) hands the selection to the first one
    const selected = files.find((file) => fileKey(file) === selectedKey) ?? files[0] ?? null;
    const selectedIndex = selected ? files.indexOf(selected) : -1;

    // the arrows move in the list on screen
    const onArrow = useEffectEvent((event: KeyboardEvent) => {
        if (isNotOurs(event)) return;
        const step = NEXT_KEYS.has(event.key) ? 1 : PREVIOUS_KEYS.has(event.key) ? -1 : 0;
        if (step === 0) return;
        if (viewed) {
            const next = commitView.neighbour(step);
            if (!next) return;
            event.preventDefault();
            commitView.open(next);
            return;
        }
        const next = files[selectedIndex + step];
        if (!next) return;
        event.preventDefault();
        setSelectedKey(fileKey(next));
    });
    useEffect(() => {
        window.addEventListener('keydown', onArrow);
        return () => window.removeEventListener('keydown', onArrow);
    }, []);

    // `Esc` is progressive: it leaves the commit before it zooms out. Listened to while capturing,
    // so it comes before the workspace's keys, which skip a key already handled.
    const onEscape = useEffectEvent((event: KeyboardEvent) => {
        if (!viewed || event.key !== 'Escape' || event.defaultPrevented || isNotOurs(event)) return;
        event.preventDefault();
        commitView.leave();
    });
    useEffect(() => {
        window.addEventListener('keydown', onEscape, { capture: true });
        return () => window.removeEventListener('keydown', onEscape, { capture: true });
    }, []);

    return (
        <div className="flex h-full flex-col">
            {snapshot.isError ? (
                <div className="border-b border-ui-border bg-ui-danger-soft px-4 py-2 text-sm text-ui-danger-soft-text">
                    {errorMessage(snapshot.error)}
                </div>
            ) : null}
            {/* about the working tree: not shown while its files make room for a commit's */}
            {snapshot.data?.summary.truncated && !viewed ? (
                <div className="border-b border-ui-border bg-ui-warning-soft px-4 py-2 text-sm text-ui-warning-soft-text">
                    Too many changes: only the first {snapshot.data.summary.totals.files} changed
                    files are listed. A folder such as node_modules may be missing from .gitignore.
                </div>
            ) : null}
            <div className="flex min-h-0 flex-1">
                <aside className="flex w-72 shrink-0 flex-col border-r border-ui-border bg-ui-surface">
                    <div className="min-h-0 flex-1">
                        {viewed ? (
                            <CommitFileList
                                commit={viewed}
                                files={commitView.files}
                                selectedPath={commitFile?.path ?? null}
                                onSelect={commitView.open}
                                onBack={commitView.leave}
                            />
                        ) : (
                            <FileList
                                files={snapshot.data?.files ?? []}
                                selectedKey={selected ? fileKey(selected) : null}
                                onSelect={(file) => setSelectedKey(fileKey(file))}
                            />
                        )}
                    </div>
                    <RecentCommits
                        root={project.root}
                        open={commitView.listOpen}
                        onOpenChange={commitView.setListOpen}
                        viewed={viewed}
                        onView={commitView.view}
                    />
                </aside>
                <main className="min-w-0 flex-1 bg-ui-surface-subtle">
                    {viewed ? (
                        commitFile ? (
                            <CommitDiffView
                                key={`${viewed.sha}:${commitFile.path}`}
                                root={project.root}
                                commit={viewed}
                                file={commitFile}
                                header={header}
                            />
                        ) : null
                    ) : selected ? (
                        <ChangeDiffView
                            key={fileKey(selected)}
                            root={project.root}
                            file={selected}
                            header={header}
                        />
                    ) : snapshot.isSuccess ? (
                        <div className="flex h-full flex-col items-center justify-center gap-2 text-ui-text-muted">
                            <IconCircleCheck size={32} stroke={1.5} />
                            <p className="text-sm">Nothing to review. The working tree is clean.</p>
                        </div>
                    ) : null}
                </main>
            </div>
        </div>
    );
}
