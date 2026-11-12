import { useEffect, useMemo } from 'react';
import {
    INBOX_BOOK,
    NoteReferencesProvider,
    newNoteTarget,
    notesPanel,
    notesTarget,
    useCaptures,
} from '@/modules/notes';
import {
    activeProject,
    useProjectLayout,
    useProjects,
    useRelocateFolder,
} from '@/modules/projects';
import {
    changesPanel,
    filesPanel,
    useFolderKind,
    useReadFolderAgain,
    useRepositoryChangeSubscription,
} from '@/modules/repository';
import { useSettingsWhenRead } from '@/modules/settings';
import { errorMessage } from '@/shared/errors/app-error';
import { useTranslation } from '@/shared/i18n';
import type { ProjectFolder } from '@/shared/projects/project-info';
import { whenIdle } from '@/shared/ui/when-idle';
import { zoomControlAt } from '@/shared/ui/zoom-transition';
import { useAppNoteReferences } from '../note-references';
import { deepestLevel, projectTiles, SUMMARIES } from '../panels';
import { useProblems } from '../problems';
import { useProjectEntry } from '../project-entry';
import { useShowWindowWhen } from '../providers';
import { QuickNoteHost } from '../QuickNoteHost';
import { TopBar } from '../top-bar/TopBar';
import type { ZoomLevel } from '../workspace';
import { useWorkspaceKeys } from '../workspace-view/workspace-keys';
import { useZoomGestures } from '../workspace-view/zoom-gestures';
import { preloadDialogs } from './dialog-chunks';
import { useDialogs } from './dialogs';
import { useNavigation } from './navigation';
import { useOverviewAsks } from './overview-asks';
import { usePaletteContent } from './palette-content';
import { ShellDialogs } from './ShellDialogs';
import { Workspace } from './Workspace';

/** The window: the top bar, and below it the workspace at its zoom level. */
export function AppShell() {
    useRepositoryChangeSubscription();
    const projects = useProjects();
    const i18n = useTranslation();
    const project = projects.data ? activeProject(projects.data) : null;
    // its folder on screen, which its panels of files read, and the ways into a project
    const entry = useProjectEntry(projects.data, project);
    const { folder } = entry;
    // what that folder is: read without starting a stopped WSL distro, which its Start panel starts
    const folderKind = useFolderKind(folder);
    // the project's panels, from what it has; none at all projects without projects, and not yet
    // while its folder's kind is read
    const tiles =
        project && !folderKind.waiting
            ? projectTiles(folderKind.stopped ? 'stopped' : folderKind.kind)
            : null;
    const hasChanges = tiles?.panels.includes(changesPanel) ?? false;
    // how the project lays out its tiles: which wait in the top bar, the side column's split
    const [layout, changeLayout] = useProjectLayout(project?.id ?? null);
    const nav = useNavigation({
        list: projects.data,
        project,
        folder,
        tiles,
        layout,
        changeLayout,
    });
    const { level, panel, zoom, show } = nav;
    // the window, created hidden, shows with the workspace laid out, not an empty shell, and in
    // the language of the settings
    const settingsRead = useSettingsWhenRead() !== undefined;
    useShowWindowWhen(!projects.isPending && settingsRead);
    const dialogs = useDialogs();

    // a project's panels, or the panel already full screen
    const openProject = (projectId: string) => {
        const from = level;
        entry.enter(projectId, () => {
            if (from === 0) nav.toPanels();
        });
    };
    const asks = useOverviewAsks({ enter: entry.enter, nav });
    const readAgain = useReadFolderAgain();
    const { mutate: relocate } = useRelocateFolder({ readAgain, open: openProject });
    const fixProject = useMemo(
        () => ({
            locate: (folder: ProjectFolder) => relocate(folder.id),
            remove: dialogs.setRemoving,
            retry: (folder: ProjectFolder) => readAgain(folder.id),
        }),
        [relocate, readAgain, dialogs.setRemoving],
    );
    const problems = useProblems(projects.data, dialogs.openSettings, fixProject);

    // a capture becomes a note of the project whose panels show, else of the Inbox; it comes into
    // view, where its card opens its marks
    useCaptures(
        () => (level > 0 && project ? project.id : INBOX_BOOK),
        (book, note) => {
            if (book === INBOX_BOOK) asks.revealInboxNote(note.id);
            else show(notesPanel.id, notesTarget(note.list, note.id));
        },
    );

    // a file a note names: in Files full screen, at its lines; in another folder of the project
    // when only that one has it, which comes on screen first (asked which, when several do)
    const noteReferences = useAppNoteReferences({
        project: level > 0 ? project : null,
        folder,
        hasFiles: tiles?.panels.includes(filesPanel) ?? false,
        openInFiles: (fileAsked, folderId, among) => {
            if (!project) return;
            if (folderId === null && among === null) {
                zoom(2, filesPanel, fileAsked);
                return;
            }
            // that folder on screen first; picked among several, whichever is
            const of = { project: project.id, folder: folderId };
            entry.enter(project.id, () => zoom(2, filesPanel, fileAsked, of), folderId, among);
        },
    });

    const palette = usePaletteContent({
        open: dialogs.palette.open,
        list: projects.data,
        project,
        folder,
        tiles,
        hasChanges,
        stopped: folderKind.stopped,
        nav,
        enter: entry.enter,
        openProject,
        revealInboxNote: asks.revealInboxNote,
    });

    // every project has its panels (level 1), whatever its folder turns out to be; entering one
    // of several folders asks which
    const zoomIn = () => {
        if (project && level === 0) openProject(project.id);
        else if (project && level < (tiles ? deepestLevel(tiles) : 1)) {
            zoom((level + 1) as ZoomLevel);
        }
    };

    useWorkspaceKeys({
        list: projects.data,
        // at all projects the row selected; below, the project's panels, a folder asked for
        switchProject: (projectId) =>
            level === 0 ? entry.select(projectId) : openProject(projectId),
        zoomIn,
        zoomOut: nav.zoomOut,
        // full screen, from a project's panels or another panel
        openPanel: (next) => {
            if (level > 0 && tiles?.fullScreen.includes(next)) zoom(2, next);
        },
        moveTile: nav.moveTile,
        toggleSettings: dialogs.toggleSettings,
        togglePalette: dialogs.togglePalette,
        toggleHelp: dialogs.toggleHelp,
        // in Notes at the same zoom, its field ready; at all projects, in the Inbox
        newNote: () => {
            if (level > 0) show(notesPanel.id, newNoteTarget());
            else asks.focusComposer();
        },
    });
    useZoomGestures({
        // what is under the pointer zooms in as its own control would, so the zoom grows from it
        zoomInAt: (target) => {
            const control = zoomControlAt(target);
            if (control) control.click();
            else zoomIn();
        },
        zoomOut: nav.zoomOut,
    });

    // the settings and the palette are a key away: their code is fetched while nothing else
    // happens
    useEffect(
        () =>
            whenIdle(() => {
                preloadDialogs();
                for (const { summary } of SUMMARIES) void summary.preload();
            }),
        [],
    );

    return (
        <QuickNoteHost>
            <div className="flex h-full flex-col">
                <TopBar
                    level={level}
                    project={project}
                    folder={folder}
                    panel={panel}
                    problems={problems}
                    onZoom={zoom}
                    onOpenSettings={dialogs.toggleSettings}
                    onOpenPalette={() => dialogs.togglePalette('names')}
                    helpOpen={dialogs.helpOpen}
                    onToggleHelp={dialogs.toggleHelp}
                    minimized={
                        level === 1 && tiles
                            ? tiles.side.filter((tile) => layout.minimized.includes(tile.id))
                            : []
                    }
                    onRestore={nav.restore}
                    facts={level >= 1 && hasChanges}
                    onShowFolder={entry.showFolder}
                    onEditFolders={() => dialogs.setEditing(project)}
                />
                <main className="min-h-0 flex-1">
                    {projects.isError ? (
                        <div className="flex h-full items-center justify-center p-8 text-sm text-ui-danger">
                            {errorMessage(projects.error, i18n)}
                        </div>
                    ) : projects.data ? (
                        // the notes' references: only the workspace shows notes
                        <NoteReferencesProvider value={noteReferences}>
                            <Workspace
                                list={projects.data}
                                zoomed={entry.zoomed}
                                openProject={openProject}
                                project={project}
                                folder={folder}
                                tiles={tiles}
                                level={level}
                                panel={level === 1 ? nav.selectedTile : panel}
                                request={nav.request}
                                targetTaken={nav.targetTaken}
                                zoom={zoom}
                                select={nav.select}
                                layout={layout}
                                onSplit={(split) =>
                                    changeLayout((current) => ({ ...current, split }))
                                }
                                onMinimize={nav.minimize}
                                show={show}
                                findInFiles={dialogs.findInFiles}
                                showFolder={entry.showFolder}
                                onEdit={dialogs.setEditing}
                                onRemove={dialogs.setRemoving}
                                asked={asks.asked}
                                onAskedTaken={asks.takeAsked}
                                focusInbox={asks.focusInbox}
                                onInboxFocused={asks.inboxFocused}
                                inboxNote={asks.inboxNote}
                                onInboxNoteRevealed={asks.inboxRevealed}
                            />
                        </NoteReferencesProvider>
                    ) : null}
                </main>
                <ShellDialogs dialogs={dialogs} picker={entry.picker} palette={palette} />
            </div>
        </QuickNoteHost>
    );
}
