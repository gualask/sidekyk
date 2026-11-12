import { useMemo } from 'react';
import { useTranslation } from '@/shared/i18n';
import type { ChangedFile } from '../../../model/repository.types';
import { type FileListRow, fileKey, fileListRows } from '../../../model/tree/file-groups';
import { LIST_HEADING } from '../../lists/list-styles';
import { useVirtualRows } from '../../lists/use-virtual-rows';
import { VirtualItems } from '../../lists/VirtualItems';
import { FILE_ROW_HEIGHT, FileRow } from './FileRow';

const GROUP_ROW_HEIGHT = 28;
/** Space above every group heading but the first. */
const GROUP_GAP = 8;
const LIST_PADDING = 8;

/** The changed files, grouped by area. Only the rows on screen are rendered. */
export function FileList({
    files,
    selectedKey,
    onSelect,
}: {
    files: readonly ChangedFile[];
    selectedKey: string | null;
    onSelect: (file: ChangedFile) => void;
}) {
    const rows = useMemo(() => fileListRows(files), [files]);
    const { t } = useTranslation();
    const { scrollRef, virtualizer } = useVirtualRows<HTMLElement>({
        count: rows.length,
        size: (index) => rowHeight(rows[index]),
        padding: LIST_PADDING,
        selectedIndex: rows.findIndex(
            (row) => row.kind === 'file' && fileKey(row.file) === selectedKey,
        ),
    });

    return (
        <nav
            ref={scrollRef}
            aria-label={t('changes.changedFiles')}
            className="h-full overflow-y-auto"
        >
            <VirtualItems virtualizer={virtualizer}>
                {(index) => {
                    const row = rows[index];
                    if (!row) return null;
                    return row.kind === 'group' ? (
                        <GroupHeading group={row} />
                    ) : (
                        <FileRow
                            file={row.file}
                            selected={fileKey(row.file) === selectedKey}
                            onSelect={() => onSelect(row.file)}
                        />
                    );
                }}
            </VirtualItems>
        </nav>
    );
}

/** A row's height: a file's, or a group heading's, with room above all but the first. */
function rowHeight(row: FileListRow | undefined): number {
    if (row?.kind !== 'group') return FILE_ROW_HEIGHT;
    return row.first ? GROUP_ROW_HEIGHT : GROUP_ROW_HEIGHT + GROUP_GAP;
}

/** A group's heading: its area and how many files it has. */
function GroupHeading({ group }: { group: Extract<FileListRow, { kind: 'group' }> }) {
    const { t } = useTranslation();
    return (
        <h2
            className={`flex items-end justify-between px-4 pb-1.5 leading-4 ${LIST_HEADING} ${
                group.first ? 'h-7' : 'h-9'
            }`}
        >
            {t(group.label)}
            <span className="font-mono tabular-nums">{group.count}</span>
        </h2>
    );
}
