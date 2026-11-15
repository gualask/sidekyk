import { Tooltip } from '@base-ui/react/tooltip';
import { errorMessage } from '@/shared/errors/app-error';
import { useTranslation } from '@/shared/i18n';
import { relativeTime } from '@/shared/time/relative-time';
import { isMerge, shortSha } from '../../../model/history/commits';
import type { GraphRow } from '../../../model/history/graph';
import type { Commit } from '../../../model/repository.types';
import { type CommitTooltip, TOOLTIP_DELAY_MS } from './CommitTip';
import { GraphCell, GraphColumn } from './GraphCell';
import { RefLabels } from './RefLabel';

/** A row of the list, `COMMIT_ROW_HEIGHT` high (`h-8`): the graph's column, then the rest. */
const ROW = 'flex h-8 w-full items-center gap-2.5 pr-4 pl-3';

/**
 * A commit's row. In the list, as VS Code's graph: the subject and when, the rest (its refs among
 * it) in the tooltip, the lane's color telling the branch; under the whole panel, its refs, author
 * and hash too, in columns.
 */
export function CommitRow({
    commit,
    row,
    lanes,
    wide,
    viewed,
    now,
    timeWidth,
    tooltip,
    onView,
}: {
    commit: Commit;
    row: GraphRow;
    /** The graph's width, in lanes, the same in every row. */
    lanes: number;
    /** Under the whole panel, with room for columns. */
    wide: boolean;
    viewed: boolean;
    now: number;
    /** The time column's width, in characters. */
    timeWidth: number;
    tooltip: CommitTooltip;
    onView: () => void;
}) {
    const i18n = useTranslation();
    return (
        <Tooltip.Trigger
            handle={tooltip}
            payload={commit}
            delay={TOOLTIP_DELAY_MS}
            aria-current={viewed ? 'true' : undefined}
            onClick={onView}
            className={`${ROW} text-left text-sm transition-colors ${
                viewed ? 'bg-ui-accent-soft text-ui-accent-on-soft' : 'hover:bg-ui-surface-hover'
            }`}
        >
            <GraphCell row={row} merge={isMerge(commit)} lanes={lanes} />
            <span className="min-w-20 flex-1 truncate">{commit.subject}</span>
            {wide ? (
                <>
                    <RefLabels refs={commit.refs} viewed={viewed} />
                    <span className="w-36 shrink-0 truncate text-xs text-ui-text-muted">
                        {commit.author}
                    </span>
                    <span className="w-[8ch] shrink-0 font-mono text-[11px] text-ui-text-muted">
                        {shortSha(commit.sha)}
                    </span>
                </>
            ) : null}
            <span
                className="shrink-0 text-right font-mono text-[11px] whitespace-nowrap text-ui-text-muted tabular-nums"
                style={{ width: `${timeWidth}ch` }}
            >
                {relativeTime(commit.time, now, i18n)}
            </span>
        </Tooltip.Trigger>
    );
}

/** The last row while older commits follow: being read, or why they could not be. */
export function OlderCommits({ error, lanes }: { error: unknown; lanes: number }) {
    const i18n = useTranslation();
    return (
        <p className={`${ROW} text-xs ${error ? 'text-ui-danger' : 'text-ui-text-muted'}`}>
            <GraphColumn lanes={lanes} />
            <span className="truncate">
                {error ? errorMessage(error, i18n) : i18n.t('commit.older')}
            </span>
        </p>
    );
}
