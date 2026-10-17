import { Autocomplete } from '@base-ui/react/autocomplete';
import { Dialog } from '@base-ui/react/dialog';
import { IconFileSearch, IconSearch } from '@tabler/icons-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef, useState } from 'react';
import { errorMessage } from '@/shared/errors/app-error';
import { CHANGE_MARK_TONE, CHANGE_MARK_WORD } from '@/shared/git/change-mark';
import { shortcutLabel } from '@/shared/platform/shortcut';
import {
    type ContentResults,
    MIN_CONTENT_QUERY,
    useContentSearch,
} from '../application/content-search';
import { useSearch } from '../application/search.queries';
import {
    contentRows,
    highlightParts,
    type PaletteItem,
    type PalettePanel,
    type PaletteRow,
    paletteRows,
} from '../model/palette-rows';
import type { Highlight } from '../model/search.types';

const ROW_HEIGHT = { group: 28, item: 34, more: 30, file: 28 } as const;
/** A line found in a file: lower than a place to go, many come at once. */
const LINE_HEIGHT = 28;

/** What the palette looks for: places to go by name (`⌘K`), or a text in the files (`⌘F`). */
export type PaletteMode = 'names' | 'contents';

const MODES: { mode: PaletteMode; label: string; key: string }[] = [
    { mode: 'names', label: 'Go to', key: 'K' },
    { mode: 'contents', label: 'Find in files', key: 'F' },
];

/** What the palette opens: the app knows how to get there. */
export interface PaletteActions {
    openProject: (root: string) => void;
    openPanel: (id: string) => void;
    /** A file, or a line of it where a text was found, to look through in the viewer. */
    openFile: (path: string, find?: { query: string; line: number }) => void;
}

/**
 * The command palette: one field to go to a project, a panel of the project on screen or one of
 * its files by name (`⌘K`), or to find a text in that project's files (`⌘F`); the other key, or
 * a tab, switches while keeping what is typed. Names are ranked in the backend, the best first;
 * lines found come under their files as they are read, the file shown first. The list is
 * virtualized. `↑`/`↓` move, `↵` opens, `Esc` empties the field, then closes. Loaded with Base
 * UI's dialog and autocomplete once the window is idle after the first paint.
 */
export function CommandPalette({
    open,
    onOpenChange,
    mode,
    onModeChange,
    initialText,
    projectName,
    root,
    currentFile,
    panels,
    actions,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    mode: PaletteMode;
    onModeChange: (mode: PaletteMode) => void;
    /** What the field holds as the palette opens: empty, or a text from a file's find bar. */
    initialText: string;
    /** The project on screen, whose panels and files are offered; null when there is none. */
    projectName: string | null;
    /** The project whose files are searched; null when all projects show. */
    root: string | null;
    /** The file the project shows, whose lines found come first. */
    currentFile: string | null;
    panels: readonly PalettePanel[];
    actions: PaletteActions;
}) {
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup
                    aria-label="Command palette"
                    className="dialog-popup top-[14vh] flex w-[min(680px,calc(100vw-32px))] flex-col overflow-hidden"
                >
                    <Palette
                        mode={mode}
                        onModeChange={onModeChange}
                        initialText={initialText}
                        projectName={projectName}
                        root={root}
                        currentFile={currentFile}
                        panels={panels}
                        onOpen={(item, query) => {
                            onOpenChange(false);
                            if (item.kind === 'project') actions.openProject(item.root);
                            else if (item.kind === 'panel') actions.openPanel(item.id);
                            else if (item.kind === 'file') actions.openFile(item.path);
                            else actions.openFile(item.path, { query, line: item.number });
                        }}
                    />
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

/**
 * The field and its list, mounted while the palette is open: each opening starts from
 * `initialText`.
 */
function Palette({
    mode,
    onModeChange,
    initialText,
    projectName,
    root,
    currentFile,
    panels,
    onOpen,
}: {
    mode: PaletteMode;
    onModeChange: (mode: PaletteMode) => void;
    initialText: string;
    projectName: string | null;
    root: string | null;
    currentFile: string | null;
    panels: readonly PalettePanel[];
    onOpen: (item: PaletteItem, query: string) => void;
}) {
    const [query, setQuery] = useState(initialText);
    const titles = useMemo(() => panels.map((panel) => panel.title), [panels]);
    const contents = mode === 'contents';
    const names = useSearch(query, titles, root, !contents);
    const found = useContentSearch(contents ? root : null, query);
    const { items, rows } = useMemo(() => {
        if (contents)
            return found ? contentRows(found.files, currentFile) : { items: [], rows: [] };
        return names.data ? paletteRows(names.data, panels, projectName) : { items: [], rows: [] };
    }, [contents, found, currentFile, names.data, panels, projectName]);
    // the row of each item, to bring the one highlighted into view
    const itemRows = useMemo(
        () => rows.flatMap((row, rowIndex) => (row.kind === 'item' ? [rowIndex] : [])),
        [rows],
    );

    const scroller = useRef<HTMLDivElement>(null);
    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => scroller.current,
        estimateSize: (index) => {
            const row = rows[index];
            return row.kind === 'item' && row.item.kind === 'line'
                ? LINE_HEIGHT
                : ROW_HEIGHT[row.kind];
        },
        overscan: 8,
        paddingStart: 6,
        paddingEnd: 6,
    });
    const empty = contents
        ? contentsNotice(root, query, found)
        : names.data && rows.length === 0
          ? 'Nothing found.'
          : null;

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
            <div className="flex items-center gap-2.5 border-b border-ui-border pr-3 pl-[18px]">
                {contents ? (
                    <IconFileSearch size={16} className="shrink-0 text-ui-text-muted" aria-hidden />
                ) : (
                    <IconSearch size={16} className="shrink-0 text-ui-text-muted" aria-hidden />
                )}
                <Autocomplete.Input
                    aria-label={contents ? 'Find in files' : 'Go to'}
                    placeholder={placeholder(mode, root, projectName)}
                    spellCheck={false}
                    autoComplete="off"
                    className="h-[50px] min-w-0 flex-1 border-0 bg-transparent text-[15px] text-ui-text outline-none placeholder:text-ui-text-muted"
                    onKeyDown={(event) => {
                        // Esc empties the field first, then closes the palette
                        if (event.key === 'Escape' && query) {
                            event.preventDefault();
                            event.stopPropagation();
                            setQuery('');
                        }
                    }}
                />
                <div className="flex shrink-0 gap-0.5 rounded-md bg-ui-surface-subtle p-0.5">
                    {MODES.map((choice) => (
                        <button
                            key={choice.mode}
                            type="button"
                            title={`${choice.label} (${shortcutLabel(choice.key)})`}
                            aria-pressed={choice.mode === mode}
                            onClick={() => onModeChange(choice.mode)}
                            className={`h-6 rounded px-2 text-xs ${
                                choice.mode === mode
                                    ? 'bg-ui-surface text-ui-text shadow-sm'
                                    : 'text-ui-text-muted hover:text-ui-text'
                            }`}
                        >
                            {choice.label}
                        </button>
                    ))}
                </div>
            </div>
            {empty ? (
                <div className="px-4 py-8 text-center text-[13px] text-ui-text-muted">{empty}</div>
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
                                onOpen={(item) => onOpen(item, query)}
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
                {contents && root && query.trim().length >= MIN_CONTENT_QUERY ? (
                    <span className="ml-auto" aria-live="polite">
                        {contentsStatus(found, query)}
                    </span>
                ) : null}
            </div>
        </Autocomplete.Root>
    );
}

function placeholder(mode: PaletteMode, root: string | null, projectName: string | null): string {
    if (mode === 'names') return root ? 'Go to project, panel or file…' : 'Go to project or panel…';
    return root
        ? `Find in the files of ${projectName ?? 'the project'}…`
        : 'Open a project to find in its files';
}

/** What the list says instead of lines found: why there are none yet, or none at all. */
function contentsNotice(
    root: string | null,
    query: string,
    found: ContentResults | null,
): string | null {
    if (!root || !query.trim()) return null;
    if (query.trim().length < MIN_CONTENT_QUERY) {
        return `Type at least ${MIN_CONTENT_QUERY} characters.`;
    }
    if (!found || found.files.length > 0) return null;
    if (found.status === 'failed') return errorMessage(found.error);
    return found.status === 'done' && found.query === query ? 'Nothing found.' : null;
}

/** How far the search went: still reading, or what it found. */
function contentsStatus(found: ContentResults | null, query: string): string {
    if (!found || found.status === 'searching' || found.query !== query) return 'Searching…';
    if (found.status === 'failed') return '';
    const lines = found.files.reduce((sum, file) => sum + file.lines.length, 0);
    const files = found.files.length;
    const count = found.more
        ? `${lines.toLocaleString()}+ lines`
        : `${lines.toLocaleString()} ${lines === 1 ? 'line' : 'lines'}`;
    return `${count} in ${files} ${files === 1 ? 'file' : 'files'}`;
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
    if (row.kind === 'file') {
        return (
            <div
                role="presentation"
                style={style}
                className="flex items-end gap-2 px-[18px] pb-1 font-mono text-[12px] text-ui-text-secondary"
            >
                <span className="min-w-0 truncate">{row.path}</span>
                <span className="ml-auto shrink-0 font-sans text-[11px] text-ui-text-muted">
                    {row.count}
                </span>
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
                {item.kind === 'line' ? (
                    <span className="w-9 shrink-0 text-right font-mono text-[11px] text-ui-text-muted tabular-nums group-data-highlighted:text-ui-accent-on-soft">
                        {item.number}
                    </span>
                ) : null}
                <Label
                    text={item.label}
                    highlights={item.highlights}
                    mono={item.kind === 'file' || item.kind === 'line'}
                />
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
