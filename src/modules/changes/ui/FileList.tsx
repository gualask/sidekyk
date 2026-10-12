import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef } from 'react';
import { fileKey, fileListRows, splitPath } from '../model/file-groups';
import type { ChangedFile } from '../model/repository.types';
import { KindBadge } from './KindBadge';
import { LineCounts } from './LineCounts';

/** Fixed heights, so the virtualized list knows every row's place without measuring it. */
const FILE_ROW_HEIGHT = 32;
const GROUP_ROW_HEIGHT = 28;
/** Space above every group heading but the first. */
const GROUP_GAP = 8;
const LIST_PADDING = 8;

function FileRow({
    file,
    selected,
    onSelect,
}: {
    file: ChangedFile;
    selected: boolean;
    onSelect: (file: ChangedFile) => void;
}) {
    const { name, dir } = splitPath(file.path);
    return (
        <button
            type="button"
            aria-current={selected ? 'true' : undefined}
            title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}
            onClick={() => onSelect(file)}
            className={`flex h-8 w-full items-center gap-2 px-4 text-left text-sm transition-colors ${
                selected ? 'bg-ui-accent-soft text-ui-accent-on-soft' : 'hover:bg-ui-surface-hover'
            }`}
        >
            <KindBadge kind={file.kind} />
            <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{name}</span>
                {dir ? <span className="ml-1.5 text-xs text-ui-text-muted">{dir}</span> : null}
            </span>
            <span className="shrink-0 text-[11px]">
                <LineCounts
                    additions={file.additions}
                    deletions={file.deletions}
                    binary={file.binary}
                />
            </span>
        </button>
    );
}

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
    const scrollRef = useRef<HTMLElement>(null);
    const rows = useMemo(() => fileListRows(files), [files]);
    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: (index) => {
            const row = rows[index];
            if (row?.kind !== 'group') return FILE_ROW_HEIGHT;
            return row.first ? GROUP_ROW_HEIGHT : GROUP_ROW_HEIGHT + GROUP_GAP;
        },
        paddingStart: LIST_PADDING,
        paddingEnd: LIST_PADDING,
        overscan: 10,
    });

    // keyboard navigation can move the selection out of view
    const selectedIndex = rows.findIndex(
        (row) => row.kind === 'file' && fileKey(row.file) === selectedKey,
    );
    useEffect(() => {
        if (selectedIndex >= 0) virtualizer.scrollToIndex(selectedIndex, { align: 'auto' });
    }, [selectedIndex, virtualizer]);

    return (
        <nav ref={scrollRef} aria-label="Changed files" className="h-full overflow-y-auto">
            <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map((item) => {
                    const row = rows[item.index];
                    if (!row) return null;
                    return (
                        <div
                            key={item.key}
                            className="absolute top-0 left-0 w-full"
                            style={{ transform: `translateY(${item.start}px)` }}
                        >
                            {row.kind === 'group' ? (
                                <h2
                                    className={`flex items-end justify-between px-4 pb-1.5 text-[11px] leading-4 font-semibold tracking-wide text-ui-text-muted uppercase ${
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
                                    onSelect={onSelect}
                                />
                            )}
                        </div>
                    );
                })}
            </div>
        </nav>
    );
}
