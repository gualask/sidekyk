import { type ComponentProps, useCallback, useMemo } from 'react';
import { INBOX_BOOK, notesPanel, notesTarget } from '@/modules/notes';
import type { ProjectList } from '@/modules/projects';
import { changesPanel, filesPanel, fileTarget, useShownFile } from '@/modules/repository';
import type { loadCommandPalette, PaletteActions, PaletteBook } from '@/modules/search';
import { type Translator, useTranslation } from '@/shared/i18n';
import type { PanelDefinition } from '@/shared/panels/panel';
import type { ProjectFolder, ProjectInfo } from '@/shared/projects/project-info';
import { remoteMachine } from '@/shared/projects/project-place';
import { type ProjectTiles, panelById, panelShortcut } from '../panels';
import type { useProjectEntry } from '../project-entry';
import type { Navigation } from './navigation';

type PaletteProps = ComponentProps<
    Awaited<ReturnType<typeof loadCommandPalette>>['CommandPalette']
>;

/** What the palette offers and opens: its props but its own state (open, mode, first text). */
export type PaletteContent = Omit<
    PaletteProps,
    'open' | 'onOpenChange' | 'mode' | 'onModeChange' | 'initialText'
>;

/**
 * What the command palette offers from where the window is, and where each thing it finds opens:
 * the project on screen's panels, files and notes, or at all projects every book's.
 */
export function usePaletteContent({
    open,
    list,
    project,
    folder,
    tiles,
    hasChanges,
    stopped,
    nav,
    enter,
    openProject,
    revealInboxNote,
}: {
    /** The palette is open: only then is the file shown worked out. */
    open: boolean | null;
    list: ProjectList | undefined;
    project: ProjectInfo | null;
    folder: ProjectFolder | null;
    tiles: ProjectTiles | null;
    /** The project's panels have Changes. */
    hasChanges: boolean;
    /** The folder's WSL distro is stopped. */
    stopped: boolean;
    nav: Navigation;
    enter: ReturnType<typeof useProjectEntry>['enter'];
    openProject: (projectId: string) => void;
    /** Brings an Inbox note into view in its column. */
    revealInboxNote: (note: string | null) => void;
}): PaletteContent {
    const i18n = useTranslation();
    const { level, panel, zoom, show } = nav;
    // a project's own, at its panels
    const panels = useMemo(
        () => offeredPanels(level > 0 && tiles ? tiles.fullScreen : [], i18n),
        [level, tiles, i18n],
    );
    // the file shown, whose lines found come first: worked out only while the palette is open
    const shownFile = useShownFile(level > 0 ? (folder?.id ?? null) : null);
    // the books of the lists and notes the palette finds at all projects
    const books = useCallback(
        (book: string): PaletteBook =>
            book === INBOX_BOOK
                ? { name: i18n.t('inbox.title'), inbox: true }
                : {
                      name: list?.projects.find((p) => p.id === book)?.name ?? '',
                      inbox: false,
                  },
        [list, i18n],
    );
    const actions: PaletteActions = {
        openProject,
        openPanel: (id) => {
            const next = panelById(id);
            if (next && tiles?.fullScreen.includes(next)) zoom(2, next);
        },
        // as a file picked in the tree: in Changes when the project has it and Files is not full
        // screen, else in Files full screen, its tile being the tree alone
        openFile: (path, find) => {
            const asked = fileTarget(path, null, find ?? null);
            if (hasChanges && !(level === 2 && panel === filesPanel)) show(changesPanel.id, asked);
            else if (tiles?.panels.includes(filesPanel)) zoom(2, filesPanel, asked);
        },
        // in Notes, at the same zoom; at all projects, an Inbox note in its column, a project's
        // in its panels, Notes selected
        openNotes: (book, notesList, note) => {
            if (book === INBOX_BOOK) revealInboxNote(note);
            else if (level > 0 && book === project?.id) {
                show(notesPanel.id, notesTarget(notesList, note));
            } else {
                const of = { project: book, folder: null };
                enter(book, () => zoom(1, notesPanel, notesTarget(notesList, note), of));
            }
        },
    };

    return {
        projectName: project?.name ?? null,
        projectId: level > 0 ? (project?.id ?? null) : null,
        filesFolder: tiles?.panels.includes(filesPanel) ? (folder?.id ?? null) : null,
        // the distro to start before the project's files are searched, while it is stopped
        stoppedDistro: stopped && folder ? remoteMachine(folder) : null,
        currentFile: open ? shownFile() : null,
        panels,
        books,
        actions,
    };
}

/**
 * The panels the palette offers, by their titles in the UI's language: a panel no key opens
 * stands in for others (Start), with nothing to go to.
 */
function offeredPanels(offered: readonly PanelDefinition[], i18n: Translator) {
    return offered.flatMap((each) => {
        const shortcut = panelShortcut(each);
        return shortcut
            ? [{ id: each.id, title: i18n.t(each.title), icon: each.icon, shortcut }]
            : [];
    });
}
