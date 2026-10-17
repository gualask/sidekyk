import { Autocomplete } from '@base-ui/react/autocomplete';
import { Dialog } from '@base-ui/react/dialog';
import { IconSearch } from '@tabler/icons-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef, useState } from 'react';
import { CHANGE_MARK_TONE, CHANGE_MARK_WORD } from '@/shared/git/change-mark';
import { useSearch } from '../application/search.queries';
import {
    highlightParts,
    type PaletteItem,
    type PalettePanel,
    type PaletteRow,
    paletteRows,
} from '../model/palette-rows';
import type { Highlight } from '../model/search.types';

const ROW_HEIGHT = { group: 28, item: 34, more: 30 } as const;

/** What the palette opens: the app knows how to get there. */
export interface PaletteActions {
    openProject: (root: string) => void;
    openPanel: (id: string) => void;
    openFile: (path: string) => void;
}

/**
 * The command palette (`⌘K`): one field to go to a project, a panel of the project on screen or
 * one of its files. What is typed is ranked in the backend; the list shows the best
 * first, virtualized. `↑`/`↓` move, `↵` opens, `Esc` empties the field, then closes. Loaded with
 * Base UI's dialog and autocomplete once the window is idle after the first paint.
 */
export function CommandPalette({
    open,
    onOpenChange,
    projectName,
    root,
    panels,
    actions,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The project on screen, whose panels and files are offered; null when there is none. */
    projectName: string | null;
    /** The project whose files are searched; null when all projects show. */
    root: string | null;
    panels: readonly PalettePanel[];
    actions: PaletteActions;
}) {
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup
                    aria-label="Command palette"
                    className="dialog-popup top-[14vh] flex w-[min(620px,calc(100vw-32px))] flex-col overflow-hidden"
                >
                    <Palette
                        projectName={projectName}
                        root={root}
                        panels={panels}
                        onOpen={(item) => {
                            onOpenChange(false);
                            if (item.kind === 'project') actions.openProject(item.root);
                            else if (item.kind === 'panel') actions.openPanel(item.id);
                            else actions.openFile(item.path);
                        }}
                    />
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

/** The field and its list, mounted while the palette is open: each opening starts empty. */
function Palette({
    projectName,
    root,
    panels,
    onOpen,
}: {
    projectName: string | null;
    root: string | null;
    panels: readonly PalettePanel[];
    onOpen: (item: PaletteItem) => void;
}) {
    const [query, setQuery] = useState('');
    const titles = useMemo(() => panels.map((panel) => panel.title), [panels]);
    const search = useSearch(query, titles, root);
    const { items, rows } = useMemo(
        () =>
            search.data ? paletteRows(search.data, panels, projectName) : { items: [], rows: [] },
        [search.data, panels, projectName],
    );
    // the row of each item, to bring the one highlighted into view
    const itemRows = useMemo(
        () => rows.flatMap((row, rowIndex) => (row.kind === 'item' ? [rowIndex] : [])),
        [rows],
    );

    const scroller = useRef<HTMLDivElement>(null);
    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => scroller.current,
        estimateSize: (index) => ROW_HEIGHT[rows[index].kind],
        overscan: 8,
        paddingStart: 6,
        paddingEnd: 6,
    });

    return (
        <Autocomplete.Root
            open
            inline
            virtualized
            items={items}
            filter={null}
            value={query}
            onValueChange={setQuery}
            itemToStringValue={(item: PaletteItem) => item.label}
            autoHighlight="always"
            keepHighlight
            onItemHighlighted={(item, { reason, index }) => {
                if (!item || reason === 'pointer') return;
                const row = itemRows[index];
                if (row !== undefined) virtualizer.scrollToIndex(row, { align: 'auto' });
            }}
        >
            <div className="flex items-center gap-2.5 border-b border-ui-border px-[18px]">
                <IconSearch size={16} className="shrink-0 text-ui-text-muted" aria-hidden />
                <Autocomplete.Input
                    aria-label="Go to"
                    placeholder={root ? 'Go to project, panel or file…' : 'Go to project or panel…'}
                    spellCheck={false}
                    autoComplete="off"
                    className="h-[50px] w-full border-0 bg-transparent text-[15px] text-ui-text outline-none placeholder:text-ui-text-muted"
                    onKeyDown={(event) => {
                        // Esc empties the field first, then closes the palette
                        if (event.key === 'Escape' && query) {
                            event.preventDefault();
                            event.stopPropagation();
                            setQuery('');
                        }
                    }}
                />
            </div>
            {search.data && rows.length === 0 ? (
                <div className="px-4 py-8 text-center text-[13px] text-ui-text-muted">
                    Nothing found.
                </div>
            ) : null}
            <Autocomplete.List
                ref={scroller}
                className="max-h-[50vh] min-h-0 overflow-auto overscroll-contain empty:hidden"
            >
                {rows.length > 0 ? (
                    <div
                        role="presentation"
                        className="relative w-full"
                        style={{ height: virtualizer.getTotalSize() }}
                    >
                        {virtualizer.getVirtualItems().map((virtual) => (
                            <Row
                                key={virtual.key}
                                row={rows[virtual.index]}
                                count={items.length}
                                start={virtual.start}
                                size={virtual.size}
                                onOpen={onOpen}
                            />
                        ))}
                    </div>
                ) : null}
            </Autocomplete.List>
            <div className="dialog-foot">
                <span>
                    <kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> move
                </span>
                <span>
                    <kbd className="kbd">↵</kbd> open
                </span>
                <span>
                    <kbd className="kbd">Esc</kbd> close
                </span>
            </div>
        </Autocomplete.Root>
    );
}

function Row({
    row,
    count,
    start,
    size,
    onOpen,
}: {
    row: PaletteRow;
    count: number;
    start: number;
    size: number;
    onOpen: (item: PaletteItem) => void;
}) {
    const style = {
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: size,
        transform: `translateY(${start}px)`,
    } as const;

    if (row.kind === 'group') {
        return (
            <div
                role="presentation"
                style={style}
                className="flex items-end px-[18px] pb-1 text-[11px] font-semibold tracking-[.04em] text-ui-text-muted uppercase"
            >
                {row.label}
            </div>
        );
    }
    if (row.kind === 'more') {
        return (
            <div
                role="presentation"
                style={style}
                className="flex items-center px-[18px] text-xs text-ui-text-muted"
            >
                {row.count === 1 ? '1 more file' : `${row.count} more files`}: type more to narrow
            </div>
        );
    }

    const { item, index } = row;
    return (
        <div role="presentation" style={style} className="px-1.5">
            <Autocomplete.Item
                value={item}
                index={index}
                aria-setsize={count}
                aria-posinset={index + 1}
                onClick={() => onOpen(item)}
                className="group flex h-full cursor-default items-center gap-2.5 rounded-lg px-3 outline-none select-none data-highlighted:bg-ui-accent-soft data-highlighted:text-ui-accent-on-soft"
            >
                <Label text={item.label} highlights={item.highlights} mono={item.kind === 'file'} />
                <span className="ml-auto shrink-0 text-xs text-ui-text-muted group-data-highlighted:text-ui-accent-on-soft">
                    {hint(item)}
                </span>
            </Autocomplete.Item>
        </div>
    );
}

/** What a row says on its right: a panel's key, how a file changed; nothing for a project. */
function hint(item: PaletteItem) {
    if (item.kind === 'panel') return <kbd className="kbd">{item.shortcut}</kbd>;
    if (item.kind !== 'file' || !item.mark) return null;
    return <span className={CHANGE_MARK_TONE[item.mark]}>{CHANGE_MARK_WORD[item.mark]}</span>;
}

/** The item's text, with the letters the query matched in bold. */
function Label({
    text,
    highlights,
    mono,
}: {
    text: string;
    highlights: readonly Highlight[];
    mono: boolean;
}) {
    return (
        <span className={`min-w-0 truncate ${mono ? 'font-mono text-[12.5px]' : ''}`}>
            {highlightParts(text, highlights).map((part) =>
                part.matched ? (
                    <mark key={part.start} className="bg-transparent font-bold text-current">
                        {part.text}
                    </mark>
                ) : (
                    <span key={part.start}>{part.text}</span>
                ),
            )}
        </span>
    );
}
