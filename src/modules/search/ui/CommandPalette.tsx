import { Autocomplete } from '@base-ui/react/autocomplete';
import { Dialog } from '@base-ui/react/dialog';
import {
    IconFile,
    IconFileSearch,
    IconFolderCode,
    IconList,
    IconNote,
    IconSearch,
} from '@tabler/icons-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef, useState } from 'react';
import { errorMessage } from '@/shared/errors/app-error';
import { CHANGE_MARK_TONE, CHANGE_MARK_WORD } from '@/shared/git/change-mark';
import { type MessageKey, RichText, type Translator, useTranslation } from '@/shared/i18n';
import { shortcutLabel } from '@/shared/platform/shortcut';
import { FolderPath } from '@/shared/projects/FolderPath';
import { RemoteTag } from '@/shared/projects/RemoteTag';
import {
    type ContentResults,
    MIN_CONTENT_QUERY,
    useContentSearch,
} from '../application/content-search';
import { useSearch } from '../application/search.queries';
import {
    contentRows,
    highlightParts,
    type PaletteBook,
    type PaletteItem,
    type PalettePanel,
    type PaletteRow,
    paletteRows,
} from '../model/palette-rows';
import type { Highlight } from '../model/search.types';

const ROW_HEIGHT = { group: 28, item: 34, more: 30, file: 28 } as const;
/** A project: its name, and its folder under it. */
const PROJECT_HEIGHT = 46;
/** A line found in a file: lower than a place to go, many come at once. */
const LINE_HEIGHT = 28;

/** What the palette looks for: places to go by name (`⌘K`), or a text in the files (`⌘F`). */
export type PaletteMode = 'names' | 'contents';

const MODES: { mode: PaletteMode; label: MessageKey; key: string }[] = [
    { mode: 'names', label: 'common.goTo', key: 'K' },
    { mode: 'contents', label: 'common.findInFiles', key: 'F' },
];

/** What the palette opens: the app knows how to get there. */
export interface PaletteActions {
    openProject: (projectId: string) => void;
    openPanel: (id: string) => void;
    /** A file, or a line of it where a text was found, to look through in the viewer. */
    openFile: (path: string, find?: { query: string; line: number }) => void;
    /**
     * A list of notes of a book, and one of its notes to bring into view, if any: the project on
     * screen's, or at all projects any project's or the Inbox's.
     */
    openNotes: (book: string, list: string, note: string | null) => void;
}

/**
 * The command palette: one field to go to a project or a list or note of any book (at all
 * projects), a panel of the project on screen or one of its files, lists or notes (`⌘K`), or to find a text in that project's files (`⌘F`); the other key, or
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
    projectId,
    hasFiles,
    stoppedDistro,
    currentFile,
    panels,
    books,
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
    /** The project whose files and notes are searched; null when all projects show. */
    projectId: string | null;
    /** Whether that project has files to search: a folder. */
    hasFiles: boolean;
    /** The WSL distro holding that project's folder while it is stopped: no files until started. */
    stoppedDistro: string | null;
    /** The file the project shows, whose lines found come first. */
    currentFile: string | null;
    panels: readonly PalettePanel[];
    /** The books of the lists and notes found at all projects, by id. */
    books: (book: string) => PaletteBook;
    actions: PaletteActions;
}) {
    const { t } = useTranslation();
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup
                    aria-label={t('palette.label')}
                    className="dialog-popup top-[14vh] flex w-[min(680px,calc(100vw-32px))] flex-col overflow-hidden"
                >
                    <Palette
                        mode={mode}
                        onModeChange={onModeChange}
                        initialText={initialText}
                        projectName={projectName}
                        projectId={projectId}
                        hasFiles={hasFiles}
                        stoppedDistro={stoppedDistro}
                        currentFile={currentFile}
                        panels={panels}
                        books={books}
                        onOpen={(item, query) => {
                            onOpenChange(false);
                            if (item.kind === 'project') actions.openProject(item.projectId);
                            else if (item.kind === 'panel') actions.openPanel(item.id);
                            else if (item.kind === 'file') actions.openFile(item.path);
                            else if (item.kind === 'list') {
                                actions.openNotes(item.book, item.id, null);
                            } else if (item.kind === 'note') {
                                actions.openNotes(item.book, item.list, item.id);
                            } else actions.openFile(item.path, { query, line: item.number });
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
    projectId,
    hasFiles,
    stoppedDistro,
    currentFile,
    panels,
    books,
    onOpen,
}: {
    mode: PaletteMode;
    onModeChange: (mode: PaletteMode) => void;
    initialText: string;
    projectName: string | null;
    projectId: string | null;
    hasFiles: boolean;
    stoppedDistro: string | null;
    currentFile: string | null;
    panels: readonly PalettePanel[];
    books: (book: string) => PaletteBook;
    onOpen: (item: PaletteItem, query: string) => void;
}) {
    const [query, setQuery] = useState(initialText);
    const i18n = useTranslation();
    const { t } = i18n;
    const titles = useMemo(() => panels.map((panel) => panel.title), [panels]);
    const contents = mode === 'contents';
    const names = useSearch(query, titles, projectId, !contents);
    // the project whose files are searched for a text: none without a folder
    const filesOf = hasFiles ? projectId : null;
    const found = useContentSearch(contents ? filesOf : null, query);
    const { items, rows } = useMemo(() => {
        if (contents)
            return found ? contentRows(found.files, currentFile, i18n) : { items: [], rows: [] };
        // typed or not as the query the matches on screen answer, not the one still coming
        const shown = names.data;
        // inside a project, every list and note found is its own
        const rowBooks = projectId ? null : books;
        return shown
            ? paletteRows(
                  shown.results,
                  panels,
                  projectName,
                  shown.query.trim() !== '',
                  rowBooks,
                  i18n,
              )
            : { items: [], rows: [] };
    }, [contents, found, currentFile, names.data, panels, projectName, projectId, books, i18n]);
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
            if (row.kind !== 'item') return ROW_HEIGHT[row.kind];
            if (row.item.kind === 'project') return PROJECT_HEIGHT;
            return row.item.kind === 'line' ? LINE_HEIGHT : ROW_HEIGHT.item;
        },
        overscan: 8,
        paddingStart: 6,
        paddingEnd: 6,
    });
    const empty = contents
        ? contentsNotice(filesOf, query, found, i18n)
        : names.data && rows.length === 0
          ? t('palette.nothingFound')
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
                    aria-label={t(contents ? 'common.findInFiles' : 'common.goTo')}
                    placeholder={placeholder(
                        mode,
                        projectId,
                        hasFiles,
                        stoppedDistro,
                        projectName,
                        i18n,
                    )}
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
                            title={`${t(choice.label)} (${shortcutLabel(choice.key)})`}
                            aria-pressed={choice.mode === mode}
                            onClick={() => onModeChange(choice.mode)}
                            className={`h-6 rounded px-2 text-xs ${
                                choice.mode === mode
                                    ? 'bg-ui-surface text-ui-text shadow-sm'
                                    : 'text-ui-text-muted hover:text-ui-text'
                            }`}
                        >
                            {t(choice.label)}
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
                    <RichText
                        text={t('palette.move')}
                        parts={{
                            up: <kbd className="kbd">↑</kbd>,
                            down: <kbd className="kbd">↓</kbd>,
                        }}
                    />
                </span>
                <span>
                    <RichText
                        text={t('palette.open')}
                        parts={{ enter: <kbd className="kbd">↵</kbd> }}
                    />
                </span>
                <span>
                    <RichText
                        text={t('common.escCloses')}
                        parts={{ esc: <kbd className="kbd">Esc</kbd> }}
                    />
                </span>
                {contents && filesOf && query.trim().length >= MIN_CONTENT_QUERY ? (
                    <span className="ml-auto" aria-live="polite">
                        {contentsStatus(found, query, i18n)}
                    </span>
                ) : null}
            </div>
        </Autocomplete.Root>
    );
}

function placeholder(
    mode: PaletteMode,
    projectId: string | null,
    hasFiles: boolean,
    stoppedDistro: string | null,
    projectName: string | null,
    { t }: Translator,
): string {
    if (mode === 'names') {
        if (!projectId) return t('palette.placeholder.namesNoProject');
        return t(hasFiles ? 'palette.placeholder.names' : 'palette.placeholder.namesNotes');
    }
    if (!projectId) return t('palette.placeholder.contentsNoProject');
    if (stoppedDistro) {
        return t('palette.placeholder.contentsStopped', { distro: stoppedDistro });
    }
    if (!hasFiles) return t('palette.placeholder.contentsNoFolder');
    return projectName
        ? t('palette.placeholder.contents', { name: projectName })
        : t('palette.placeholder.contentsUnnamed');
}

/** What the list says instead of lines found: why there are none yet, or none at all. */
function contentsNotice(
    projectId: string | null,
    query: string,
    found: ContentResults | null,
    i18n: Translator,
): string | null {
    if (!projectId || !query.trim()) return null;
    if (query.trim().length < MIN_CONTENT_QUERY) {
        return i18n.t('palette.typeMore', { count: MIN_CONTENT_QUERY });
    }
    if (!found || found.files.length > 0) return null;
    if (found.status === 'failed') return errorMessage(found.error, i18n);
    return found.status === 'done' && found.query === query ? i18n.t('palette.nothingFound') : null;
}

/** How far the search went: still reading, or what it found. */
function contentsStatus(
    found: ContentResults | null,
    query: string,
    { t, tp, formatTag }: Translator,
): string {
    if (!found || found.status === 'searching' || found.query !== query) {
        return t('palette.searching');
    }
    if (found.status === 'failed') return '';
    const lines = found.files.reduce((sum, file) => sum + file.lines.length, 0);
    const files = found.files.length;
    const count = lines.toLocaleString(formatTag);
    const linesFound = found.more
        ? t('palette.linesMore', { count })
        : tp('palette.lines', lines, { count });
    return tp('palette.inFiles', files, { lines: linesFound });
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
    const { t, tp } = useTranslation();
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
                {tp('palette.moreFiles', row.count)}
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
                ) : (
                    <KindIcon item={item} />
                )}
                {item.kind === 'project' ? (
                    <span className="flex min-w-0 flex-col">
                        <Label text={item.label} highlights={item.highlights} mono={false} />
                        {item.folder ? <FolderPath path={item.folder.root} /> : null}
                    </span>
                ) : (
                    <Label
                        text={item.label}
                        highlights={item.highlights}
                        mono={item.kind === 'file' || item.kind === 'line'}
                    />
                )}
                <span className="ml-auto shrink-0 text-xs text-ui-text-muted group-data-highlighted:text-ui-accent-on-soft">
                    {hint(item, t)}
                </span>
            </Autocomplete.Item>
        </div>
    );
}

const KIND_ICONS = { project: IconFolderCode, file: IconFile, list: IconList, note: IconNote };

/** What a row opens, at a glance: a project, a panel (its tile's icon), a file, a list, a note. */
function KindIcon({ item }: { item: Exclude<PaletteItem, { kind: 'line' }> }) {
    const Icon = item.kind === 'panel' ? item.icon : KIND_ICONS[item.kind];
    return (
        <Icon
            size={16}
            stroke={1.75}
            className="shrink-0 text-ui-text-muted group-data-highlighted:text-ui-accent-on-soft"
        />
    );
}

/**
 * What a row says on its right: a panel's key, how a file changed, a note's list (and project, at
 * all projects), a list's project at all projects, a project's machine when not this one.
 */
function hint(item: PaletteItem, t: Translator['t']) {
    if (item.kind === 'project') return <RemoteTag folder={item.folder} />;
    if (item.kind === 'panel') return <kbd className="kbd">{item.shortcut}</kbd>;
    if (item.kind === 'note' || item.kind === 'list') return item.hint;
    if (item.kind !== 'file' || !item.mark) return null;
    return <span className={CHANGE_MARK_TONE[item.mark]}>{t(CHANGE_MARK_WORD[item.mark])}</span>;
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
