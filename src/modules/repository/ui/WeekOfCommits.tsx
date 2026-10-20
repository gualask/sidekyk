import { useMemo } from 'react';
import { type Translator, useTranslation } from '@/shared/i18n';
import { useCommitActivity } from '../application/repository.queries';
import { ACTIVITY_DAYS, type ActivityDay, activityDays, activitySince } from '../model/activity';
import { CardWell, WellMessage } from './CardWell';
import { LineCounts } from './LineCounts';

/** `Wed 14 Oct`, as the UI's language and the system's region write it. */
const DAY_FORMAT: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' };

/**
 * The last seven days of commits on a project's card, across its width: a bar a day, as tall as
 * the lines its commits changed (to the busiest day of the week), green the lines added at the
 * bottom, red the removed above; what the week added up to over it.
 */
export function WeekOfCommits({ projectId, head }: { projectId: string; head: string | null }) {
    return (
        <CardWell>
            <WeekChart projectId={projectId} head={head} />
        </CardWell>
    );
}

function WeekChart({ projectId, head }: { projectId: string; head: string | null }) {
    const since = activitySince(new Date());
    const activity = useCommitActivity(projectId, head, since);
    const i18n = useTranslation();
    const { t } = i18n;
    const dayFormat = useMemo(
        () => new Intl.DateTimeFormat(i18n.formatTag, DAY_FORMAT),
        [i18n.formatTag],
    );
    if (activity.isError) return <WellMessage>{t('week.unreadable')}</WellMessage>;
    if (head !== null && !activity.data) return null;
    const days = activity.data ? activityDays(activity.data, since) : [];
    if (days.every((day) => day.commits === 0)) {
        return <WellMessage>{t('week.none', { count: ACTIVITY_DAYS })}</WellMessage>;
    }
    const additions = days.reduce((total, day) => total + day.additions, 0);
    const deletions = days.reduce((total, day) => total + day.deletions, 0);
    const busiest = Math.max(...days.map((day) => day.additions + day.deletions), 1);
    const week = { count: ACTIVITY_DAYS, additions, deletions };

    // above the overlay that opens the project, so that the tooltips show
    return (
        <div className="relative flex flex-col gap-1.5">
            <div
                className="flex items-center justify-between"
                title={t(activity.data?.more ? 'week.linesNewest' : 'week.lines', week)}
            >
                <span>{t('week.title', { count: ACTIVITY_DAYS })}</span>
                <LineCounts additions={additions} deletions={deletions} compact />
            </div>
            <div
                role="img"
                aria-label={t('week.byDay', week)}
                className="flex h-14 items-end gap-1.5 border-b border-ui-border"
            >
                {days.map((day) => (
                    <DayBar
                        key={day.start}
                        day={day}
                        busiest={busiest}
                        label={dayLabel(day, dayFormat, i18n)}
                    />
                ))}
            </div>
        </div>
    );
}

/**
 * One day, the whole column answering the pointer: added lines from the baseline up, a pixel of
 * room, removed lines above them. A day of a few lines next to a busy one still shows, both
 * colors too.
 */
function DayBar({ day, busiest, label }: { day: ActivityDay; busiest: number; label: string }) {
    const total = day.additions + day.deletions;
    const both = day.additions > 0 && day.deletions > 0;
    return (
        <div className="flex h-full flex-1 flex-col justify-end" title={label}>
            {total > 0 ? (
                <div
                    className="flex flex-col gap-px"
                    style={{ height: `${(total / busiest) * 100}%`, minHeight: both ? 5 : 2 }}
                >
                    {day.deletions > 0 ? (
                        <div
                            className="rounded-t-[2px] bg-ui-diff-del-mark"
                            style={{ flex: `${day.deletions} 1 0`, minHeight: 2 }}
                        />
                    ) : null}
                    {day.additions > 0 ? (
                        <div
                            className={`bg-ui-diff-add-mark ${both ? '' : 'rounded-t-[2px]'}`}
                            style={{ flex: `${day.additions} 1 0`, minHeight: 2 }}
                        />
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

/** `Wed 14 Oct: +1234 −340, 5 commits`. */
function dayLabel(
    { start, additions, deletions, commits }: ActivityDay,
    format: Intl.DateTimeFormat,
    { t, tp }: Translator,
): string {
    const date = format.format(new Date(start * 1000));
    if (commits === 0) return t('week.dayEmpty', { date });
    return tp('week.day', commits, { date, additions, deletions });
}
