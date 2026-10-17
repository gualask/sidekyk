import { IconChevronRight } from '@tabler/icons-react';
import type { ChangeMark, TreeRow } from '../model/file-tree';
import {
    TREE_INDENT,
    TREE_PADDING_LEFT,
    TREE_PADDING_RIGHT,
    TREE_ROW_HEIGHT,
    TREE_TWISTY,
} from './tree-layout';
import { useVirtualRows } from './use-virtual-rows';
import { VirtualItems } from './VirtualItems';

const MARK_TONE: Record<ChangeMark, string> = {
    modified: 'text-ui-warning',
    added: 'text-ui-success',
};

const MARK_WORD: Record<ChangeMark, string> = { modified: 'Modified', added: 'New' };

function tooltip(row: Exclude<TreeRow, { kind: 'more' }>, mark: ChangeMark | undefined): string {
    if (!mark) return row.path;
    return row.kind === 'folder' ? `${row.path} · has changes` : `${row.path} · ${MARK_WORD[mark]}`;
}

/** A name of the tree; a folder sharing its row with the folders inside it shows their `/`. */
function Name({ row }: { row: Exclude<TreeRow, { kind: 'more' }> }) {
    if (row.kind === 'file') return row.name;
    // each part keyed by the folders up to it, which no other part of the name repeats
    const parts = row.name.split('/');
    const upTo = parts.map((_, end) => parts.slice(0, end + 1).join('/'));
    return upTo.map((prefix) => {
        const slash = prefix.lastIndexOf('/');
        return (
            <span key={prefix}>
                {slash < 0 ? null : <span className="mx-px text-ui-text-muted">/</span>}
                {prefix.slice(slash + 1)}
            </span>
        );
    });
}

/**
 * The files of a project as a tree, folders first, of which only the rows on screen render. A
 * change colors a name as in VS Code, with no letter or mark; the tooltip says it in words. A row
 * that does not fit ends in "…", its path in the tooltip.
 */
export function FileTree({
    rows,
    marks,
    selected,
    label,
    onClick,
}: {
    rows: readonly TreeRow[];
    marks: ReadonlyMap<string, ChangeMark>;
    selected: string | null;
    label: string;
    onClick: (row: Exclude<TreeRow, { kind: 'more' }>) => void;
}) {
    const selectedIndex = rows.findIndex((row) => row.kind !== 'more' && row.path === selected);
    const { scrollRef, virtualizer } = useVirtualRows<HTMLDivElement>({
        count: rows.length,
        size: () => TREE_ROW_HEIGHT,
        padding: 4,
        selectedIndex,
    });

    return (
        <div
            ref={scrollRef}
            role="tree"
            aria-label={label}
            className="h-full overflow-y-auto overflow-x-hidden font-mono text-[12.5px]"
        >
            <VirtualItems virtualizer={virtualizer}>
                {(index) => {
                    const row = rows[index];
                    if (!row) return null;
                    const indent = TREE_PADDING_LEFT + row.depth * TREE_INDENT;
                    if (row.kind === 'more') {
                        return (
                            <div
                                className="flex h-[22px] items-center truncate font-sans text-xs text-ui-text-muted italic"
                                style={{ paddingLeft: indent + TREE_TWISTY }}
                            >
                                {row.count.toLocaleString()} more, not listed
                            </div>
                        );
                    }
                    const mark = marks.get(row.path);
                    const tone = mark
                        ? MARK_TONE[mark]
                        : row.kind === 'file'
                          ? 'text-ui-text-secondary'
                          : '';
                    const isSelected = row.path === selected;
                    return (
                        <button
                            type="button"
                            role="treeitem"
                            tabIndex={-1}
                            aria-level={row.depth + 1}
                            aria-expanded={row.kind === 'folder' ? row.open : undefined}
                            aria-selected={isSelected}
                            title={tooltip(row, mark)}
                            onClick={() => onClick(row)}
                            className={`flex h-[22px] w-full items-center text-left ${
                                isSelected ? 'bg-ui-accent-soft' : 'hover:bg-ui-surface-hover'
                            }`}
                            style={{ paddingLeft: indent, paddingRight: TREE_PADDING_RIGHT }}
                        >
                            <span
                                className="grid shrink-0 place-items-center text-ui-text-muted"
                                style={{ width: TREE_TWISTY }}
                            >
                                {row.kind === 'folder' ? (
                                    <IconChevronRight
                                        size={12}
                                        stroke={2}
                                        className={`transition-transform duration-100 ${
                                            row.open ? 'rotate-90' : ''
                                        }`}
                                    />
                                ) : null}
                            </span>
                            <span className={`min-w-0 truncate ${tone}`}>
                                <Name row={row} />
                            </span>
                        </button>
                    );
                }}
            </VirtualItems>
        </div>
    );
}
