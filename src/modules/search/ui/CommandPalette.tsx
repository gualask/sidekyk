import { Autocomplete } from '@base-ui/react/autocomplete';
import type { Virtualizer } from '@tanstack/react-virtual';
import { useMemo, useState } from 'react';
import { useTranslation } from '@/shared/i18n';
import { PickerDialog, PickerKeys } from '@/shared/ui/PickerDialog';
import { MIN_CONTENT_QUERY } from '../application/content-search';
import type {
    PaletteBook,
    PaletteItem,
    PalettePanel,
    PaletteRow as Row,
} from '../model/palette-rows';
import { PaletteField, type PaletteMode } from './PaletteField';
import { PaletteRow } from './PaletteRow';
import { contentsNotice, contentsStatus, fieldPlaceholder } from './palette-texts';
import { usePaletteRows, usePaletteVirtualizer } from './use-palette-list';

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

/** What the palette looks for, and where: what the field and its list are given. */
interface PaletteProps {
    mode: PaletteMode;
    onModeChange: (mode: PaletteMode) => void;
    /** What the field holds as the palette opens: empty, or a text from a file's find bar. */
    initialText: string;
    /** The project on screen, whose panels and files are offered; null when there is none. */
    projectName: string | null;
    /** The project whose files and notes are searched; null when all projects show. */
    projectId: string | null;
    /** The id of that project's folder on screen, whose files are searched; null without one. */
    filesFolder: string | null;
    /** The WSL distro holding that folder while it is stopped: no files until started. */
    stoppedDistro: string | null;
    /** The file the project shows, whose lines found come first. */
    currentFile: string | null;
    panels: readonly PalettePanel[];
    /** The books of the lists and notes found at all projects, by id. */
    books: (book: string) => PaletteBook;
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
    actions,
    ...palette
}: PaletteProps & {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    actions: PaletteActions;
}) {
    const { t } = useTranslation();
    return (
        <PickerDialog
            open={open}
            onOpenChange={onOpenChange}
            label={t('palette.label')}
            width="w-[min(680px,calc(100vw-32px))]"
        >
            <Palette
                {...palette}
                onOpen={(item, query) => {
                    onOpenChange(false);
                    openItem(actions, item, query);
                }}
            />
        </PickerDialog>
    );
}

/** Goes where an item leads: a line found opens its file on the text typed. */
function openItem(actions: PaletteActions, item: PaletteItem, query: string) {
    if (item.kind === 'project') actions.openProject(item.projectId);
    else if (item.kind === 'panel') actions.openPanel(item.id);
    else if (item.kind === 'file') actions.openFile(item.path);
    else if (item.kind === 'list') {
        actions.openNotes(item.book, item.id, null);
    } else if (item.kind === 'note') {
        actions.openNotes(item.book, item.list, item.id);
    } else actions.openFile(item.path, { query, line: item.number });
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
    filesFolder,
    stoppedDistro,
    currentFile,
    panels,
    books,
    onOpen,
}: PaletteProps & { onOpen: (item: PaletteItem, query: string) => void }) {
    const [query, setQuery] = useState(initialText);
    const i18n = useTranslation();
    const { t } = i18n;
    const contents = mode === 'contents';
    // the folder whose files are searched for a text: none without a project or a folder
    const filesOf = projectId ? filesFolder : null;
    const { names, found, items, rows } = usePaletteRows({
        query,
        contents,
        filesOf,
        projectId,
        projectName,
        currentFile,
        panels,
        books,
        i18n,
    });
    // the row of each item, to bring the one highlighted into view
    const itemRows = useMemo(
        () => rows.flatMap((row, rowIndex) => (row.kind === 'item' ? [rowIndex] : [])),
        [rows],
    );
    const { scroller, virtualizer } = usePaletteVirtualizer(rows);
    const empty = contents
        ? contentsNotice(filesOf, query, found, i18n)
        : names && rows.length === 0
          ? t('common.nothingFound')
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
            <PaletteField
                mode={mode}
                onModeChange={onModeChange}
                query={query}
                onClear={() => setQuery('')}
                placeholder={fieldPlaceholder(
                    mode,
                    projectId,
                    filesFolder !== null,
                    stoppedDistro,
                    projectName,
                    i18n,
                )}
            />
            {empty ? (
                <div className="px-4 py-8 text-center text-[13px] text-ui-text-muted">{empty}</div>
            ) : null}
            <Autocomplete.List
                ref={scroller}
                className="max-h-[50vh] min-h-0 overflow-auto overscroll-contain empty:hidden"
            >
                {rows.length > 0 ? (
                    <VirtualRows
                        virtualizer={virtualizer}
                        rows={rows}
                        count={items.length}
                        onOpen={(item) => onOpen(item, query)}
                    />
                ) : null}
            </Autocomplete.List>
            <PickerKeys enter={t('common.enterOpens')}>
                {contents && filesOf && query.trim().length >= MIN_CONTENT_QUERY ? (
                    <span className="ml-auto" aria-live="polite">
                        {contentsStatus(found, query, i18n)}
                    </span>
                ) : null}
            </PickerKeys>
        </Autocomplete.Root>
    );
}

/** The rows on screen, in a box as tall as the whole list. */
function VirtualRows({
    virtualizer,
    rows,
    count,
    onOpen,
}: {
    virtualizer: Virtualizer<HTMLDivElement, Element>;
    rows: readonly Row[];
    count: number;
    onOpen: (item: PaletteItem) => void;
}) {
    return (
        <div
            role="presentation"
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
        >
            {virtualizer.getVirtualItems().map((virtual) => (
                <PaletteRow
                    key={virtual.key}
                    row={rows[virtual.index]}
                    count={count}
                    start={virtual.start}
                    size={virtual.size}
                    onOpen={onOpen}
                />
            ))}
        </div>
    );
}
