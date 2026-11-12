import { CHANGE_MARK_TONE, CHANGE_MARK_WORD, type ChangeMark } from '@/shared/git/change-mark';
import { type Translator, useTranslation } from '@/shared/i18n';
import { splitPath } from '../../../model/tree/file-groups';
import { RECENT_GROUP_LABEL, type RecentRow } from '../../../model/tree/recent-files';
import { LIST_HEADING, LIST_MORE } from '../../lists/list-styles';
import { useVirtualRows } from '../../lists/use-virtual-rows';
import { VirtualItems } from '../../lists/VirtualItems';
import { TREE_ROW_HEIGHT } from '../tree/tree-layout';
import {
    RECENT_DIR_GAP,
    RECENT_PADDING_X,
    RECENT_SMALL_FONT,
    RECENT_TIME_GAP,
    type TimeFormats,
} from './recent-layout';

const GROUP_ROW_HEIGHT = 26;
/** Space above every group heading but the first. */
const GROUP_GAP = 8;

type FileRow = Extract<RecentRow, { kind: 'file' }>;

function tooltip(
    row: FileRow,
    formats: TimeFormats,
    mark: ChangeMark | undefined,
    t: Translator['t'],
): string {
    const changed = mark ? `\n${t(CHANGE_MARK_WORD[mark])}` : '';
    return `${row.file.path}\n${formats.whole(row.file.modified)}${changed}`;
}

/**
 * The tree's files by their last change, newest first, under a heading per day group, as a file
 * manager by date modified. Each row: the name, its folder, its time; a change colors the name as
 * in the tree. Only the rows on screen render; no timer, so the groups are those of the last read.
 */
export function RecentList({
    rows,
    formats,
    marks,
    selected,
    label,
    onClick,
}: {
    rows: readonly RecentRow[];
    formats: TimeFormats;
    marks: ReadonlyMap<string, ChangeMark>;
    selected: string | null;
    label: string;
    onClick: (path: string) => void;
}) {
    const { t, formatTag } = useTranslation();
    const selectedIndex = rows.findIndex(
        (row) => row.kind === 'file' && row.file.path === selected,
    );
    const { scrollRef, virtualizer } = useVirtualRows<HTMLElement>({
        count: rows.length,
        size: (index) => {
            const row = rows[index];
            if (row?.kind !== 'group') return TREE_ROW_HEIGHT;
            return row.first ? GROUP_ROW_HEIGHT : GROUP_ROW_HEIGHT + GROUP_GAP;
        },
        padding: 4,
        selectedIndex,
    });

    return (
        <nav
            ref={scrollRef}
            aria-label={label}
            className="h-full overflow-y-auto overflow-x-hidden font-mono text-[12.5px]"
        >
            <VirtualItems virtualizer={virtualizer}>
                {(index) => {
                    const row = rows[index];
                    if (!row) return null;
                    if (row.kind === 'group') {
                        return <GroupHeading row={row} label={t(RECENT_GROUP_LABEL[row.group])} />;
                    }
                    if (row.kind === 'more') {
                        return (
                            <div className={LIST_MORE} style={{ paddingInline: RECENT_PADDING_X }}>
                                {t('files.recent.more', {
                                    count: row.count.toLocaleString(formatTag),
                                })}
                            </div>
                        );
                    }
                    const { path } = row.file;
                    const mark = marks.get(path);
                    return (
                        <RecentItem
                            row={row}
                            formats={formats}
                            mark={mark}
                            title={tooltip(row, formats, mark, t)}
                            selected={path === selected}
                            onClick={() => onClick(path)}
                        />
                    );
                }}
            </VirtualItems>
        </nav>
    );
}

/** A day group's heading, with its count of files. */
function GroupHeading({
    row,
    label,
}: {
    row: Extract<RecentRow, { kind: 'group' }>;
    label: string;
}) {
    return (
        <h2
            className={`flex items-end justify-between pb-1 font-sans leading-4 ${LIST_HEADING} ${
                row.first ? 'h-[26px]' : 'h-[34px]'
            }`}
            style={{ paddingInline: RECENT_PADDING_X }}
        >
            {label}
            <span className="font-mono tabular-nums">{row.count}</span>
        </h2>
    );
}

/** A file of Recent: its name, in its change's color, its folder, then its time. */
function RecentItem({
    row,
    formats,
    mark,
    title,
    selected,
    onClick,
}: {
    row: FileRow;
    formats: TimeFormats;
    mark: ChangeMark | undefined;
    title: string;
    selected: boolean;
    onClick: () => void;
}) {
    const { path, modified } = row.file;
    const { name, dir } = splitPath(path);
    return (
        <button
            type="button"
            tabIndex={-1}
            aria-current={selected ? 'true' : undefined}
            title={title}
            onClick={onClick}
            className={`flex h-[22px] w-full items-center text-left ${
                selected ? 'bg-ui-accent-soft' : 'hover:bg-ui-surface-hover'
            }`}
            style={{ paddingInline: RECENT_PADDING_X, gap: RECENT_TIME_GAP }}
        >
            <span className="min-w-0 flex-1 truncate">
                <span className={mark ? CHANGE_MARK_TONE[mark] : 'text-ui-text-secondary'}>
                    {name}
                </span>
                {dir ? (
                    <span
                        className="text-ui-text-muted"
                        style={{ marginLeft: RECENT_DIR_GAP, fontSize: RECENT_SMALL_FONT }}
                    >
                        {dir}
                    </span>
                ) : null}
            </span>
            <span
                className="shrink-0 text-ui-text-muted tabular-nums"
                style={{ fontSize: RECENT_SMALL_FONT }}
            >
                {formats.short(modified, row.group)}
            </span>
        </button>
    );
}
