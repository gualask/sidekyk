import { useMemo } from 'react';
import { fileKey, fileListRows } from '../model/file-groups';
import type { ChangedFile } from '../model/repository.types';
import { FILE_ROW_HEIGHT, FileRow } from './FileRow';
import { LIST_HEADING } from './list-heading';
import { useVirtualRows } from './use-virtual-rows';
import { VirtualItems } from './VirtualItems';

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
    const { scrollRef, virtualizer } = useVirtualRows<HTMLElement>({
        count: rows.length,
        size: (index) => {
            const row = rows[index];
            if (row?.kind !== 'group') return FILE_ROW_HEIGHT;
            return row.first ? GROUP_ROW_HEIGHT : GROUP_ROW_HEIGHT + GROUP_GAP;
        },
        padding: LIST_PADDING,
        selectedIndex: rows.findIndex(
            (row) => row.kind === 'file' && fileKey(row.file) === selectedKey,
        ),
    });

    return (
        <nav ref={scrollRef} aria-label="Changed files" className="h-full overflow-y-auto">
            <VirtualItems virtualizer={virtualizer}>
                {(index) => {
                    const row = rows[index];
                    if (!row) return null;
                    return row.kind === 'group' ? (
                        <h2
                            className={`flex items-end justify-between px-4 pb-1.5 leading-4 ${LIST_HEADING} ${
                                row.first ? 'h-7' : 'h-9'
                            }`}
                        >
                            {row.label}
                            <span className="font-mono tabular-nums">{row.count}</span>
                        </h2>
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
