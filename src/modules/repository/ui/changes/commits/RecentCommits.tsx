import { Tooltip } from '@base-ui/react/tooltip';
import { IconChevronRight, IconLayoutBottombar, IconLayoutSidebar } from '@tabler/icons-react';
import { useEffect, useMemo } from 'react';
import { errorMessage } from '@/shared/errors/app-error';
import type { CommitsPlace } from '@/shared/git/commits-place';
import { useTranslation } from '@/shared/i18n';
import { relativeTimeWidth } from '@/shared/time/relative-time';
import { useRecentCommits } from '../../../application/queries/commits';
import { graphRows } from '../../../model/history/graph';
import type { Commit } from '../../../model/repository.types';
import { LIST_HEADING } from '../../lists/list-styles';
import { useVirtualRows } from '../../lists/use-virtual-rows';
import { VirtualItems } from '../../lists/VirtualItems';
import { CommitRow, OlderCommits } from './CommitRow';
import { CommitTooltipPopup } from './CommitTip';
import { COMMIT_ROW_HEIGHT } from './GraphCell';

const LIST_PADDING = 4;

/** The next page is read once the list shows a row this close to the end of those read. */
const READ_AHEAD_ROWS = 10;

/**
 * The graph, as in VS Code's source control: HEAD's commits and its upstream's, closed until opened
 * and read only then, a page more read as the end shows. At the bottom of the list, 40% of its
 * height, or under the list and the viewer, the panel's whole width and 40% of its height: its
 * heading's button moves it, and the settings keep where. A click on a commit shows its files in
 * the list, instead of the working tree's.
 */
export function RecentCommits({
    folderId,
    open,
    onOpenChange,
    viewed,
    onView,
    place,
    onPlaceChange,
}: {
    folderId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The commit whose files the list shows, if any. */
    viewed: Commit | null;
    onView: (commit: Commit) => void;
    place: CommitsPlace;
    onPlaceChange: (place: CommitsPlace) => void;
}) {
    const i18n = useTranslation();
    const timeWidth = useMemo(() => relativeTimeWidth(i18n), [i18n]);
    const log = useRecentCommits(folderId, open);
    const commits = useMemo(
        () => log.data?.pages.flatMap((page) => page.commits) ?? [],
        [log.data],
    );
    const rows = useMemo(() => graphRows(commits), [commits]);
    const lanes = Math.max(1, ...rows.map((row) => row.width));
    const more = log.hasNextPage;
    // the times are relative to when the list was read, so they move only with it
    const now = log.dataUpdatedAt / 1000;
    const { scrollRef, virtualizer } = useVirtualRows<HTMLDivElement>({
        // the last row says older commits are being read
        count: commits.length + (more ? 1 : 0),
        size: () => COMMIT_ROW_HEIGHT,
        padding: LIST_PADDING,
    });
    const lastShown = virtualizer.getVirtualItems().at(-1)?.index ?? -1;
    const { fetchNextPage, isFetchingNextPage, isFetchNextPageError } = log;
    const nearEnd = more && lastShown >= commits.length - READ_AHEAD_ROWS;
    useEffect(() => {
        if (nearEnd && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
    }, [nearEnd, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);
    const footer = place === 'footer';
    const tooltip = useMemo(() => Tooltip.createHandle<Commit>(), []);
    const move = i18n.t(footer ? 'commit.toSidebar' : 'commit.toFooter');

    return (
        <section
            aria-label={i18n.t('commit.recent')}
            // open, 40% of what holds it: the files, or the diff, stay the main thing
            className={`flex shrink-0 flex-col border-t border-ui-border bg-ui-surface ${open ? 'min-h-0 basis-2/5' : ''}`}
        >
            <div className="flex h-6 shrink-0 items-center pr-1.5">
                <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => onOpenChange(!open)}
                    className={`flex h-full min-w-0 flex-1 items-center gap-1 px-2.5 transition-colors hover:text-ui-text-secondary ${LIST_HEADING}`}
                >
                    <IconChevronRight
                        size={12}
                        className={`shrink-0 transition-transform motion-reduce:transition-none ${
                            open ? 'rotate-90' : ''
                        }`}
                    />
                    {i18n.t('commit.recent')}
                </button>
                <button
                    type="button"
                    title={move}
                    aria-label={move}
                    onClick={() => onPlaceChange(footer ? 'sidebar' : 'footer')}
                    className="flex size-5 shrink-0 items-center justify-center rounded text-ui-text-muted transition-colors hover:bg-ui-surface-hover hover:text-ui-text-secondary focus-visible:outline-2 focus-visible:outline-ui-accent"
                >
                    {footer ? <IconLayoutSidebar size={13} /> : <IconLayoutBottombar size={13} />}
                </button>
            </div>
            {open ? (
                <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
                    {/* a later page's failure is told at the end, where it was asked for */}
                    {log.isError && !isFetchNextPageError ? (
                        <p className="px-4 py-1.5 text-xs text-ui-danger">
                            {errorMessage(log.error, i18n)}
                        </p>
                    ) : null}
                    {log.isSuccess && commits.length === 0 ? (
                        <p className="px-4 py-1.5 text-xs text-ui-text-muted">
                            {i18n.t('commit.none')}
                        </p>
                    ) : null}
                    <VirtualItems virtualizer={virtualizer}>
                        {(index) => {
                            const commit = commits[index];
                            const row = rows[index];
                            return commit && row ? (
                                <CommitRow
                                    commit={commit}
                                    row={row}
                                    lanes={lanes}
                                    wide={footer}
                                    viewed={commit.sha === viewed?.sha}
                                    now={now}
                                    timeWidth={timeWidth}
                                    tooltip={tooltip}
                                    onView={() => onView(commit)}
                                />
                            ) : (
                                <OlderCommits
                                    error={isFetchNextPageError ? log.error : null}
                                    lanes={lanes}
                                />
                            );
                        }}
                    </VirtualItems>
                    <CommitTooltipPopup tooltip={tooltip} footer={footer} />
                </div>
            ) : null}
        </section>
    );
}
