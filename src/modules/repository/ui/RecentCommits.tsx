import { IconChevronRight } from '@tabler/icons-react';
import { errorMessage } from '@/shared/errors/app-error';
import { relativeTime } from '@/shared/time/relative-time';
import { useRecentCommits } from '../application/repository.queries';
import { commitDate, shortSha } from '../model/commits';
import type { Commit } from '../model/repository.types';
import { LIST_HEADING } from './list-heading';
import { useVirtualRows } from './use-virtual-rows';
import { VirtualItems } from './VirtualItems';

/** Fixed heights, so the virtualized list knows every row's place without measuring it. */
const COMMIT_ROW_HEIGHT = 32;
const LIST_PADDING = 4;

/**
 * The commit's place on the branch, as VS Code's graph draws it: a dot on one line, a ring around
 * a dot for a merge. The line leaves the newest commit downward and goes on past the last one
 * listed when the branch has older ones.
 */
function GraphNode({ merge, above, below }: { merge: boolean; above: boolean; below: boolean }) {
    return (
        <span className="relative flex h-full w-3.5 shrink-0 items-center justify-center">
            {above ? (
                <span className="absolute top-0 h-1/2 w-0.5 bg-ui-accent-muted opacity-60" />
            ) : null}
            {below ? (
                <span className="absolute bottom-0 h-1/2 w-0.5 bg-ui-accent-muted opacity-60" />
            ) : null}
            {merge ? (
                <span className="relative flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-ui-accent bg-ui-surface">
                    <span className="h-1.5 w-1.5 rounded-full bg-ui-accent" />
                </span>
            ) : (
                <span className="relative h-2.5 w-2.5 rounded-full bg-ui-accent" />
            )}
        </span>
    );
}

function CommitRow({
    commit,
    viewed,
    above,
    below,
    now,
    onView,
}: {
    commit: Commit;
    viewed: boolean;
    above: boolean;
    below: boolean;
    now: number;
    onView: () => void;
}) {
    return (
        <button
            type="button"
            aria-current={viewed ? 'true' : undefined}
            title={`${commit.subject}\n${shortSha(commit.sha)} · ${commit.author} · ${commitDate(commit)}`}
            onClick={onView}
            className={`flex h-8 w-full items-center gap-2.5 pr-4 pl-4 text-left text-sm transition-colors ${
                viewed ? 'bg-ui-accent-soft text-ui-accent-on-soft' : 'hover:bg-ui-surface-hover'
            }`}
        >
            <GraphNode merge={commit.merge} above={above} below={below} />
            <span className="min-w-0 flex-1 truncate">{commit.subject}</span>
            <span className="max-w-16 shrink-0 truncate text-xs text-ui-text-muted">
                {commit.author}
            </span>
            <span className="w-7 shrink-0 text-right font-mono text-[11px] text-ui-text-muted tabular-nums">
                {relativeTime(commit.time, now)}
            </span>
        </button>
    );
}

/**
 * The last commits of the branch, as in VS Code's source control: a section at the bottom of the
 * list, closed until opened and read only then, and 40% of the list's height when open. A
 * click on a commit shows its files in the list above, instead of the working tree's.
 */
export function RecentCommits({
    root,
    open,
    onOpenChange,
    viewed,
    onView,
}: {
    root: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The commit whose files the list above shows, if any. */
    viewed: Commit | null;
    onView: (commit: Commit) => void;
}) {
    const log = useRecentCommits(root, open);
    const commits = log.data?.commits ?? [];
    const more = log.data?.more ?? false;
    // the times are relative to when the list was read, so they move only with it
    const now = log.dataUpdatedAt / 1000;
    const { scrollRef, virtualizer } = useVirtualRows<HTMLDivElement>({
        // the last row says the branch goes on
        count: commits.length + (more ? 1 : 0),
        size: () => COMMIT_ROW_HEIGHT,
        padding: LIST_PADDING,
    });

    return (
        <section
            aria-label="Recent commits"
            // open, 40% of the list's height: the files above stay the main thing
            className={`flex shrink-0 flex-col border-t border-ui-border ${open ? 'min-h-0 basis-2/5' : ''}`}
        >
            <button
                type="button"
                aria-expanded={open}
                onClick={() => onOpenChange(!open)}
                className={`flex h-6 shrink-0 items-center gap-1 px-2.5 transition-colors hover:text-ui-text-secondary ${LIST_HEADING}`}
            >
                <IconChevronRight
                    size={12}
                    className={`shrink-0 transition-transform motion-reduce:transition-none ${
                        open ? 'rotate-90' : ''
                    }`}
                />
                Recent commits
            </button>
            {open ? (
                <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
                    {log.isError ? (
                        <p className="px-4 py-1.5 text-xs text-ui-danger">
                            {errorMessage(log.error)}
                        </p>
                    ) : null}
                    {log.isSuccess && commits.length === 0 ? (
                        <p className="px-4 py-1.5 text-xs text-ui-text-muted">No commits yet.</p>
                    ) : null}
                    <VirtualItems virtualizer={virtualizer}>
                        {(index) => {
                            const commit = commits[index];
                            return commit ? (
                                <CommitRow
                                    commit={commit}
                                    viewed={commit.sha === viewed?.sha}
                                    above={index > 0}
                                    below={index < commits.length - 1 || more}
                                    now={now}
                                    onView={() => onView(commit)}
                                />
                            ) : (
                                <p className="flex h-8 items-center gap-2.5 pr-4 pl-4 text-xs text-ui-text-muted">
                                    <span className="flex h-full w-3.5 shrink-0 justify-center">
                                        <span className="h-1/2 w-0.5 bg-ui-accent-muted opacity-30" />
                                    </span>
                                    The last {commits.length} commits.
                                </p>
                            );
                        }}
                    </VirtualItems>
                </div>
            ) : null}
        </section>
    );
}
