import { Tooltip } from '@base-ui/react/tooltip';
import { useId, useMemo } from 'react';
import { useTranslation } from '@/shared/i18n';
import { zoomControlAt } from '@/shared/ui/zoom-transition';
import { type ActivitySource, useCommitActivities } from '../../application/queries/commits';
import {
    ACTIVITY_DAYS,
    type ActivityDay,
    activityDays,
    activitySince,
} from '../../model/history/activity';
import { type SparklineBox, sparklineArea, sparklinePath } from '../../model/history/sparkline';
import { LineCounts } from '../LineCounts';

/** The strip the line is drawn in; a week without commits, or not read yet, is its baseline. */
const STRIP = 'block h-6 w-full';
const BASELINE = `${STRIP} border-b border-ui-border`;

/** `Wed`, in the UI's language: seven days in a row never repeat one. */
const DAY_FORMAT: Intl.DateTimeFormatOptions = { weekday: 'short' };

/**
 * The last seven days of commits at the end of a project's row, without a number: a line through
 * the lines each day's commits changed, to the busiest day of the week. Under the pointer or the
 * focus it shows the week a day a row, with each day's lines added and removed and the week's. A week without commits, or commits
 * that cannot be read, is the baseline alone (the line under the row's name says why a
 * repository cannot be read). A project of several repositories shows their commits together.
 */
export function WeekOfCommits({ sources }: { sources: readonly ActivitySource[] }) {
    const since = activitySince(new Date());
    const activity = useCommitActivities(sources, since);
    const { t } = useTranslation();
    // the baseline alone while the commits are read too, so that the rows line up
    if (!activity.data) return <div aria-hidden="true" className={BASELINE} />;
    const days = activityDays(activity.data, since);
    const { quiet, additions, deletions } = weekTotals(days);
    const label = quiet
        ? t('week.none', { count: ACTIVITY_DAYS })
        : t('week.byDay', { count: ACTIVITY_DAYS, additions, deletions });

    return (
        <Tooltip.Root>
            <Tooltip.Trigger
                delay={250}
                // above the overlay that opens the project, so that the pointer reaches it; a
                // click still opens the project, through the row's own control
                className={`relative rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-accent ${quiet ? BASELINE : STRIP}`}
                aria-label={label}
                onClick={(event) => zoomControlAt(event.currentTarget)?.click()}
            >
                {quiet ? null : <Sparkline days={days} />}
            </Tooltip.Trigger>
            <Tooltip.Portal>
                <Tooltip.Positioner side="bottom" align="end" sideOffset={8} className="z-30">
                    <Tooltip.Popup className="menu-popup w-80 px-3 py-2.5 text-xs">
                        {quiet ? (
                            <p className="text-ui-text-muted">{label}</p>
                        ) : (
                            <WeekDetail
                                days={days}
                                additions={additions}
                                deletions={deletions}
                                newest={activity.data.more}
                            />
                        )}
                    </Tooltip.Popup>
                </Tooltip.Positioner>
            </Tooltip.Portal>
        </Tooltip.Root>
    );
}

/** The week's lines added and removed; quiet without a commit. */
function weekTotals(days: readonly ActivityDay[]) {
    return {
        quiet: days.every((day) => day.commits === 0),
        additions: days.reduce((total, day) => total + day.additions, 0),
        deletions: days.reduce((total, day) => total + day.deletions, 0),
    };
}

/**
 * The week's lines first, then a day a row, oldest first as the strip reads left to right: the
 * day, a bar as long as its lines (to the busiest day), green the added and red the removed,
 * then its lines.
 */
function WeekDetail({
    days,
    additions,
    deletions,
    newest,
}: {
    days: readonly ActivityDay[];
    additions: number;
    deletions: number;
    /** More commits were made than are read: the newest alone are counted. */
    newest: boolean;
}) {
    const { t, formatTag } = useTranslation();
    const dayFormat = useMemo(() => new Intl.DateTimeFormat(formatTag, DAY_FORMAT), [formatTag]);
    const busiest = Math.max(...days.map((day) => day.additions + day.deletions), 1);
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3 border-b border-ui-border pb-1.5">
                <span className="font-medium text-ui-text">
                    {t('week.title', { count: ACTIVITY_DAYS })}
                </span>
                <LineCounts additions={additions} deletions={deletions} />
            </div>
            <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1.5">
                {days.map((day) => (
                    <DayRow
                        key={day.start}
                        day={day}
                        busiest={busiest}
                        date={dayFormat.format(new Date(day.start * 1000))}
                    />
                ))}
            </div>
            {newest ? <p className="text-ui-text-muted">{t('week.newest')}</p> : null}
        </div>
    );
}

/** A day's row of the grid: its date, its bar, its lines (`—` without commits). */
function DayRow({ day, busiest, date }: { day: ActivityDay; busiest: number; date: string }) {
    const total = day.additions + day.deletions;
    return (
        <>
            <span className="text-ui-text-secondary">{date}</span>
            <span className="flex h-2.5" aria-hidden="true">
                {total > 0 ? <DayBar day={day} width={total / busiest} /> : null}
            </span>
            <span className="text-right">
                {total > 0 ? (
                    <LineCounts additions={day.additions} deletions={day.deletions} />
                ) : (
                    <span className="text-ui-text-muted">—</span>
                )}
            </span>
        </>
    );
}

/**
 * A day's bar, `width` of the busiest day's: green its lines added, red those removed, each part
 * as long as its lines.
 */
function DayBar({ day, width }: { day: ActivityDay; width: number }) {
    return (
        <span
            className="flex gap-px overflow-hidden rounded-[2px]"
            style={{ width: `${width * 100}%`, minWidth: 2 }}
        >
            {day.additions > 0 ? (
                <span
                    className="bg-ui-diff-add-mark"
                    style={{ flex: `${day.additions} 1 0`, minWidth: 2 }}
                />
            ) : null}
            {day.deletions > 0 ? (
                <span
                    className="bg-ui-diff-del-mark"
                    style={{ flex: `${day.deletions} 1 0`, minWidth: 2 }}
                />
            ) : null}
        </span>
    );
}

/** The box the line is drawn in, stretched to the strip: its stroke keeps its width. */
const BOX: SparklineBox = { width: 120, height: 24, inset: 1.5 };

/**
 * The lines each day's commits changed as one line, the busiest day at the top and a day without
 * commits on the baseline, over a faint area: the week's pace, its numbers on demand.
 */
function Sparkline({ days }: { days: readonly ActivityDay[] }) {
    // an id the `url(#…)` of the fill can name as is
    const fade = `fade${useId().replace(/[^\w-]/g, '')}`;
    const path = sparklinePath(
        days.map((day) => day.additions + day.deletions),
        BOX,
    );
    return (
        <svg
            aria-hidden="true"
            className="h-full w-full text-ui-text-secondary"
            viewBox={`0 0 ${BOX.width} ${BOX.height}`}
            preserveAspectRatio="none"
        >
            <defs>
                <linearGradient id={fade} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="currentColor" stopOpacity="0.22" />
                    <stop offset="1" stopColor="currentColor" stopOpacity="0" />
                </linearGradient>
            </defs>
            <path d={sparklineArea(path, BOX)} fill={`url(#${fade})`} />
            <path
                d={path}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
            />
        </svg>
    );
}
