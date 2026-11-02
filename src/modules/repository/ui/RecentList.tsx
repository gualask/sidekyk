import { CHANGE_MARK_TONE, CHANGE_MARK_WORD, type ChangeMark } from '@/shared/git/change-mark';
import { useTranslation } from '@/shared/i18n';
import { splitPath } from '../model/file-groups';
import { RECENT_GROUP_LABEL, type RecentRow } from '../model/recent-files';
import { LIST_HEADING, LIST_MORE } from './list-styles';

import {
    RECENT_DIR_GAP,
    RECENT_PADDING_X,
    RECENT_SMALL_FONT,
    RECENT_TIME_GAP,
    type TimeFormats,
} from './recent-layout';
import { TREE_ROW_HEIGHT } from './tree-layout';
import { useVirtualRows } from './use-virtual-rows';
import { VirtualItems } from './VirtualItems';

const GROUP_ROW_HEIGHT = 26;
/** Space above every group heading but the first. */
const GROUP_GAP = 8;

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
                        return (
                            <h2
                                className={`flex items-end justify-between pb-1 font-sans leading-4 ${LIST_HEADING} ${
                                    row.first ? 'h-[26px]' : 'h-[34px]'
                                }`}
                                style={{ paddingInline: RECENT_PADDING_X }}
                            >
                                {t(RECENT_GROUP_LABEL[row.group])}
                                <span className="font-mono tabular-nums">{row.count}</span>
                            </h2>
                        );
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
                    const { path, modified } = row.file;
                    const { name, dir } = splitPath(path);
                    const mark = marks.get(path);
                    const isSelected = path === selected;
                    const changed = mark ? `\n${t(CHANGE_MARK_WORD[mark])}` : '';
                    return (
                        <button
                            type="button"
                            tabIndex={-1}
                            aria-current={isSelected ? 'true' : undefined}
                            title={`${path}\n${formats.whole(modified)}${changed}`}
                            onClick={() => onClick(path)}
                            className={`flex h-[22px] w-full items-center text-left ${
                                isSelected ? 'bg-ui-accent-soft' : 'hover:bg-ui-surface-hover'
                            }`}
                            style={{ paddingInline: RECENT_PADDING_X, gap: RECENT_TIME_GAP }}
                        >
                            <span className="min-w-0 flex-1 truncate">
                                <span
                                    className={
                                        mark ? CHANGE_MARK_TONE[mark] : 'text-ui-text-secondary'
                                    }
                                >
                                    {name}
                                </span>
                                {dir ? (
                                    <span
                                        className="text-ui-text-muted"
                                        style={{
                                            marginLeft: RECENT_DIR_GAP,
                                            fontSize: RECENT_SMALL_FONT,
                                        }}
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
                }}
            </VirtualItems>
        </nav>
    );
}
