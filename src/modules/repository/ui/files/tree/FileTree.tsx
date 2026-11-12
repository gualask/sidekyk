import { IconChevronRight } from '@tabler/icons-react';
import { CHANGE_MARK_TONE, CHANGE_MARK_WORD, type ChangeMark } from '@/shared/git/change-mark';
import { type Translator, useTranslation } from '@/shared/i18n';
import type { TreeRow } from '../../../model/tree/file-tree';
import { LIST_MORE } from '../../lists/list-styles';
import { useVirtualRows } from '../../lists/use-virtual-rows';
import { VirtualItems } from '../../lists/VirtualItems';
import {
    TREE_INDENT,
    TREE_PADDING_LEFT,
    TREE_PADDING_RIGHT,
    TREE_ROW_HEIGHT,
    TREE_TWISTY,
} from './tree-layout';

/** A row of the tree that names a file or a folder. */
type NamedRow = Exclude<TreeRow, { kind: 'more' }>;

function tooltip(row: NamedRow, mark: ChangeMark | undefined, t: Translator['t']): string {
    if (!mark) return row.path;
    return `${row.path}\n${t(row.kind === 'folder' ? 'tree.hasChanges' : CHANGE_MARK_WORD[mark])}`;
}

/** The color of a name: its change's, else a file's; a folder keeps the text's. */
function nameTone(row: NamedRow, mark: ChangeMark | undefined): string {
    if (mark) return CHANGE_MARK_TONE[mark];
    return row.kind === 'file' ? 'text-ui-text-secondary' : '';
}

/** A name of the tree; a folder sharing its row with the folders inside it shows their `/`. */
function Name({ row }: { row: NamedRow }) {
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
    onClick: (row: NamedRow) => void;
}) {
    const { t, formatTag } = useTranslation();
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
                                className={LIST_MORE}
                                style={{ paddingLeft: indent + TREE_TWISTY }}
                            >
                                {t('tree.more', { count: row.count.toLocaleString(formatTag) })}
                            </div>
                        );
                    }
                    const mark = marks.get(row.path);
                    return (
                        <TreeItem
                            row={row}
                            indent={indent}
                            tone={nameTone(row, mark)}
                            title={tooltip(row, mark, t)}
                            selected={row.path === selected}
                            onClick={() => onClick(row)}
                        />
                    );
                }}
            </VirtualItems>
        </div>
    );
}

/** A file or folder of the tree: a folder's twisty, then its name, in its change's color. */
function TreeItem({
    row,
    indent,
    tone,
    title,
    selected,
    onClick,
}: {
    row: NamedRow;
    /** Its depth's room on the left, in pixels. */
    indent: number;
    tone: string;
    title: string;
    selected: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            role="treeitem"
            tabIndex={-1}
            aria-level={row.depth + 1}
            aria-expanded={row.kind === 'folder' ? row.open : undefined}
            aria-selected={selected}
            title={title}
            onClick={onClick}
            className={`flex h-[22px] w-full items-center text-left ${
                selected ? 'bg-ui-accent-soft' : 'hover:bg-ui-surface-hover'
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
                        className={`transition-transform duration-100 ${row.open ? 'rotate-90' : ''}`}
                    />
                ) : null}
            </span>
            <span className={`min-w-0 truncate ${tone}`}>
                <Name row={row} />
            </span>
        </button>
    );
}
