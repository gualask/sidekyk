import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
    InboxColumn,
    loadRemoveProjectDialog,
    newNoteTarget,
    notesPanel,
    notesTarget,
} from '@/modules/notes';
import {
    activeProject,
    type ProjectList,
    ProjectsOverview,
    type TilesLayout,
    useActivateProject,
    useProjectLayout,
    useProjects,
    useProjectsChangeSubscription,
    useRelocateProject,
    useRemoveProject,
} from '@/modules/projects';
import {
    changesPanel,
    filesPanel,
    fileTarget,
    useFolderKind,
    useReadProjectAgain,
    useRepositoryChangeSubscription,
    useShownFile,
} from '@/modules/repository';
import { loadCommandPalette, type PaletteActions, type PaletteMode } from '@/modules/search';
import { loadSettingsDialog, useSettingsWhenRead } from '@/modules/settings';
import { errorMessage } from '@/shared/errors/app-error';
import { useTranslation } from '@/shared/i18n';
import type { PanelDefinition, PanelProps, PanelTarget, SummaryPart } from '@/shared/panels/panel';
import { type ProjectInfo, projectFolder } from '@/shared/projects/project-info';
import { preloadable } from '@/shared/ui/preloadable';
import { whenIdle } from '@/shared/ui/when-idle';
import { ZOOM_NAMES, zoomControlAt, zoomTransition } from '@/shared/ui/zoom-transition';
import { PanelTile } from './PanelTile';
import {
    deepestLevel,
    INITIAL_PANEL,
    MAIN_TILE_MIN_WIDTH,
    type ProjectTiles,
    panelById,
    panelShortcut,
    projectTiles,
    SUMMARIES,
    TILE_GAP,
    tileBeside,
} from './panels';
import { useProblems } from './problems';
import { useShowWindowWhen } from './providers';
import { SideColumn } from './SideColumn';
import { TopBar } from './TopBar';
import type { ZoomLevel } from './workspace';
import { useWorkspaceKeys } from './workspace-keys';
import { useZoomGestures } from './zoom-gestures';

const SettingsDialog = preloadable(loadSettingsDialog, (module) => module.SettingsDialog);
const CommandPalette = preloadable(loadCommandPalette, (module) => module.CommandPalette);
const RemoveProjectDialog = preloadable(
    loadRemoveProjectDialog,
    (module) => module.RemoveProjectDialog,
);

/** Loaded when first asked for: the first paint does not show it. */
const ShortcutsHelp = lazy(() =>
    import('./ShortcutsHelp').then((module) => ({ default: module.ShortcutsHelp })),
);

/** The command palette: whether it is open, what it looks for, and the text it opens with. */
interface PaletteState {
    /** Null until first opened; then it stays mounted, to give the focus back as it closes. */
    open: boolean | null;
    mode: PaletteMode;
    /** Empty, or a find bar's text taken to the project's files. */
    text: string;
}

const PALETTE_UNOPENED: PaletteState = { open: null, mode: 'names', text: '' };

/** The palette closed, if it was open, as the settings open in its place. */
const closePalette = (palette: PaletteState): PaletteState =>
    palette.open ? { ...palette, open: false } : palette;

/** A project and its panels, at level 1 or full screen: the zoom carries it to and from its card. */
const PROJECT_ZOOM = { viewTransitionName: ZOOM_NAMES.project };

/** Level 1: the project's tiles, zoomed as the project. */
const TILES_STYLE = { ...PROJECT_ZOOM, gap: TILE_GAP };

/** The window: the top bar, and below it the workspace at its zoom level. */
export function AppShell() {
    useRepositoryChangeSubscription();
    const projects = useProjects();
    const i18n = useTranslation();
    // the app opens at all projects, the one shown last selected; without projects it stays there
    const [zoomLevel, setLevel] = useState<ZoomLevel>(0);
    // the panel full screen at level 2, and the tile selected at level 1
    const [shownPanel, setPanel] = useState(INITIAL_PANEL);
    // what that panel was asked to show, such as a file picked in the palette
    const [target, setTarget] = useState<Asked | null>(null);
    const project = projects.data ? activeProject(projects.data) : null;
    // what its folder is: opening the project starts a stopped WSL distro, all projects does not
    const folderKind = useFolderKind(project, { start: zoomLevel > 0 });
    // the project's panels, from what it has; none at all projects without projects, and not yet
    // while its folder's kind is read
    const tiles = project && !folderKind.waiting ? projectTiles(folderKind.kind) : null;
    const hasChanges = tiles?.panels.includes(changesPanel) ?? false;
    // as deep as the project goes: a project with one panel has no level 2, and without projects
    // only all projects shows. The level kept follows the one shown, so another project opens at
    // the level seen; while the panels wait, it stays
    const level = !project
        ? 0
        : tiles
          ? (Math.min(zoomLevel, deepestLevel(tiles)) as ZoomLevel)
          : zoomLevel;
    if (projects.data && level !== zoomLevel) setLevel(level);
    // a panel the project does not have gives way to its main one
    const panel = tiles && !tiles.panels.includes(shownPanel) ? tiles.main : shownPanel;
    // the panels the palette offers, by their titles in the UI's language: a project's own, at its
    // panels
    const palettePanels = useMemo(
        () =>
            (level > 0 && tiles ? tiles.fullScreen : []).map((offered) => ({
                id: offered.id,
                title: i18n.t(offered.title),
                icon: offered.icon,
                shortcut: panelShortcut(offered),
            })),
        [level, tiles, i18n],
    );
    // the Inbox's field takes the focus (`⌘N` at all projects)
    const [focusInbox, setFocusInbox] = useState(false);
    const inboxFocused = useCallback(() => setFocusInbox(false), []);
    // how the project lays out its tiles: which wait in the top bar, the side column's split
    const [layout, changeLayout] = useProjectLayout(project?.id ?? null);
    // a tile minimized is not selected: the main one is, which is never minimized
    const selectedTile = tiles && layout.minimized.includes(panel.id) ? tiles.main : panel;
    // the window, created hidden, shows with the workspace laid out, not an empty shell, and in
    // the language of the settings
    const settingsRead = useSettingsWhenRead() !== undefined;
    useShowWindowWhen(!projects.isPending && settingsRead);
    // null until first opened; then the dialogs stay mounted, to give the focus back as they close
    const [settingsOpen, setSettingsOpen] = useState<boolean | null>(null);
    const [palette, setPalette] = useState(PALETTE_UNOPENED);
    const [helpOpen, setHelpOpen] = useState(false);
    const toggleHelp = () => setHelpOpen((open) => !open);
    // the file shown, whose lines found come first: worked out only while the palette is open
    const shownFile = useShownFile(level > 0 ? (project?.id ?? null) : null);
    // a problem's fix in the settings: they open in place of the palette
    const openSettings = useCallback(() => {
        setPalette(closePalette);
        setSettingsOpen(true);
    }, []);
    // a project to remove, once asked what to do with its notes
    const [removing, setRemoving] = useState<ProjectInfo | null>(null);
    const { mutate: removeProject } = useRemoveProject();
    const activate = useActivateProject();

    /**
     * Every change of level goes through here, so it animates the same way everywhere. A target
     * asks the panel full screen to show something; any other move leaves the panels as they are.
     */
    const zoom = (next: ZoomLevel, nextPanel = panel, nextTarget: PanelTarget | null = null) => {
        const asked = nextTarget && project ? askedOf(project, nextPanel.id, nextTarget) : null;
        if (next === level && nextPanel === panel) {
            if (asked) setTarget(asked);
            return;
        }
        zoomTransition(() => {
            setLevel(next);
            setPanel(nextPanel);
            setTarget(asked);
        });
    };

    // a tile flies to its chip in the top bar, and back
    const minimize = (tile: PanelDefinition) =>
        zoomTransition(() => {
            changeLayout((current) => ({ ...current, minimized: [...current.minimized, tile.id] }));
            if (panel === tile && tiles) setPanel(tiles.main);
        });
    const restore = (tile: PanelDefinition) =>
        zoomTransition(() => {
            changeLayout((current) => ({
                ...current,
                minimized: current.minimized.filter((id) => id !== tile.id),
            }));
            setPanel(tile);
        });

    // a panel shows something in another: the other tile, selected (back from the top bar if it
    // waited there), or full screen in place of the first
    const show: PanelProps['show'] = (id, nextTarget) => {
        const next = panelById(id);
        if (!next || !project || !tiles?.panels.includes(next)) return;
        if (level === 2) {
            zoom(2, next, nextTarget);
            return;
        }
        if (layout.minimized.includes(next.id)) restore(next);
        else setPanel(next);
        setTarget(askedOf(project, next.id, nextTarget));
    };

    // one dialog at a time: the palette and the settings close each other. The palette's other
    // key switches what it looks for, its own key closes it
    const togglePalette = (mode: PaletteMode) => {
        setSettingsOpen((open) => (open ? false : open));
        setPalette((current) => ({
            open: !(current.open && current.mode === mode),
            mode,
            text: '',
        }));
    };
    // a file's find bar looks further, in all the project's files
    const findInFiles = (text: string) => setPalette({ open: true, mode: 'contents', text });
    const toggleSettings = () => {
        setPalette(closePalette);
        setSettingsOpen((open) => !open);
    };

    // a project's panels, or the panel already full screen
    const openProject = (projectId: string) => {
        activate(projectId);
        if (level === 0) zoom(1);
    };
    // a folder given on the command line: its project, already on screen, shows its panels
    useProjectsChangeSubscription(() => zoom(1));
    const readAgain = useReadProjectAgain();
    const { mutate: relocate } = useRelocateProject({ readAgain, open: openProject });
    const fixProject = useMemo(
        () => ({
            locate: (project: ProjectInfo) => relocate(project.id),
            remove: setRemoving,
            retry: (project: ProjectInfo) => readAgain(project.id),
        }),
        [relocate, readAgain],
    );
    const problems = useProblems(projects.data, openSettings, fixProject);

    const paletteActions: PaletteActions = {
        openProject,
        openPanel: (id) => {
            const next = panelById(id);
            if (next && tiles?.fullScreen.includes(next)) zoom(2, next);
        },
        // as a file picked in the tree: in Files' own viewer when it is full screen or there is no
        // Changes, else Changes
        openFile: (path, find) =>
            show(
                (level === 2 && panel === filesPanel) || !hasChanges
                    ? filesPanel.id
                    : changesPanel.id,
                fileTarget(path, null, find ?? null),
            ),
        // in Notes, at the same zoom
        openNotes: (list, note) => show(notesPanel.id, notesTarget(list, note)),
    };

    // every project has its panels (level 1), whatever its folder turns out to be
    const zoomIn = () => {
        if (project && level < (tiles ? deepestLevel(tiles) : 1)) zoom((level + 1) as ZoomLevel);
    };
    const zoomOut = () => {
        if (level > 0) zoom((level - 1) as ZoomLevel);
    };

    useWorkspaceKeys({
        list: projects.data,
        zoomIn,
        zoomOut,
        // full screen, from a project's panels or another panel
        openPanel: (next) => {
            if (level > 0 && tiles?.fullScreen.includes(next)) zoom(2, next);
        },
        // the arrows move among the tiles of a project's panels
        moveTile: (step) => {
            const among = level === 1 && tiles && tiles.side.length > 0 ? tiles : null;
            const next = among
                ? tileBeside(among, selectedTile, step, layout.minimized)
                : undefined;
            if (next) setPanel(next);
            return among !== null;
        },
        toggleSettings,
        togglePalette,
        toggleHelp,
        // in Notes at the same zoom, its field ready; at all projects, in the Inbox
        newNote: () => {
            if (level > 0) show(notesPanel.id, newNoteTarget());
            else setFocusInbox(true);
        },
    });
    useZoomGestures({
        // what is under the pointer zooms in as its own control would, so the zoom grows from it
        zoomInAt: (target) => {
            const control = zoomControlAt(target);
            if (control) control.click();
            else zoomIn();
        },
        zoomOut,
    });

    // the settings and the palette are a key away: their code is fetched while nothing else
    // happens
    useEffect(
        () =>
            whenIdle(() => {
                void SettingsDialog.preload();
                void CommandPalette.preload();
                for (const summary of SUMMARIES) void summary.preload();
            }),
        [],
    );

    return (
        <div className="flex h-full flex-col">
            <TopBar
                level={level}
                project={project}
                panel={panel}
                problems={problems}
                onZoom={zoom}
                onOpenSettings={toggleSettings}
                onOpenPalette={() => togglePalette('names')}
                helpOpen={helpOpen}
                onToggleHelp={toggleHelp}
                minimized={
                    level === 1 && tiles
                        ? tiles.side.filter((tile) => layout.minimized.includes(tile.id))
                        : []
                }
                onRestore={restore}
                facts={level >= 1 && hasChanges}
            />
            <main className="min-h-0 flex-1">
                {projects.isError ? (
                    <div className="flex h-full items-center justify-center p-8 text-sm text-ui-danger">
                        {errorMessage(projects.error, i18n)}
                    </div>
                ) : projects.data ? (
                    <Workspace
                        list={projects.data}
                        project={project}
                        tiles={tiles}
                        level={level}
                        panel={level === 1 ? selectedTile : panel}
                        target={target}
                        zoom={zoom}
                        select={setPanel}
                        layout={layout}
                        onSplit={(split) => changeLayout((current) => ({ ...current, split }))}
                        onMinimize={minimize}
                        show={show}
                        findInFiles={findInFiles}
                        onRemove={setRemoving}
                        focusInbox={focusInbox}
                        onInboxFocused={inboxFocused}
                    />
                ) : null}
            </main>
            {removing ? (
                <Suspense fallback={null}>
                    <RemoveProjectDialog.Component
                        key={removing.id}
                        project={removing}
                        onRemove={() => removeProject(removing.id)}
                        onClose={() => setRemoving(null)}
                    />
                </Suspense>
            ) : null}
            {helpOpen ? (
                <Suspense fallback={null}>
                    <ShortcutsHelp onClose={() => setHelpOpen(false)} />
                </Suspense>
            ) : null}
            {settingsOpen === null ? null : (
                <Suspense fallback={null}>
                    <SettingsDialog.Component open={settingsOpen} onOpenChange={setSettingsOpen} />
                </Suspense>
            )}
            {palette.open === null ? null : (
                <Suspense fallback={null}>
                    <CommandPalette.Component
                        open={palette.open}
                        onOpenChange={(open) => setPalette((current) => ({ ...current, open }))}
                        mode={palette.mode}
                        onModeChange={(mode) => setPalette((current) => ({ ...current, mode }))}
                        initialText={palette.text}
                        projectName={project?.name ?? null}
                        projectId={level > 0 ? (project?.id ?? null) : null}
                        hasFiles={tiles?.panels.includes(filesPanel) ?? false}
                        currentFile={palette.open ? shownFile() : null}
                        panels={palettePanels}
                        actions={paletteActions}
                    />
                </Suspense>
            )}
        </div>
    );
}

/** The main tile fills what the side column leaves, keeping its least width while the window allows. */
const MAIN_SIZE = { flexGrow: 1, flexBasis: 0, minWidth: `min(${MAIN_TILE_MIN_WIDTH}px, 100%)` };

/** A tile of the side column fills its slot. */
const SIDE_SIZE = { flexGrow: 1, flexBasis: 0 };

/** What a panel was asked to show, and which panel of which project: no other project's shows it. */
interface Asked {
    project: string;
    panel: string;
    target: PanelTarget;
}

function askedOf(project: ProjectInfo, panel: string, target: PanelTarget): Asked {
    return { project: project.id, panel, target };
}

function Workspace({
    list,
    project,
    tiles,
    level,
    panel,
    target,
    zoom,
    select,
    show,
    findInFiles,
    layout,
    onSplit,
    onMinimize,
    onRemove,
    focusInbox,
    onInboxFocused,
}: {
    list: ProjectList;
    project: ProjectInfo | null;
    /** The project's panels; null with no project, or while its folder's kind is read. */
    tiles: ProjectTiles | null;
    level: ZoomLevel;
    /** Full screen at level 2 (and at level 1 with one panel), the selected tile at level 1. */
    panel: PanelDefinition;
    target: Asked | null;
    zoom: (level: ZoomLevel, panel?: PanelDefinition) => void;
    select: (panel: PanelDefinition) => void;
    show: PanelProps['show'];
    findInFiles: PanelProps['findInFiles'];
    layout: TilesLayout;
    onSplit: (split: number) => void;
    onMinimize: (panel: PanelDefinition) => void;
    /** Asks to remove a project. */
    onRemove: (project: ProjectInfo) => void;
    /** The Inbox's field takes the focus. */
    focusInbox: boolean;
    onInboxFocused: () => void;
}) {
    const targetOf = (id: string) =>
        target?.project === project?.id && target?.panel === id ? target.target : null;
    // all projects: the Inbox, then the cards, which give way first in a narrow window
    if (!project || level === 0) {
        return (
            <div className="flex h-full">
                <InboxColumn focusComposer={focusInbox} onComposerFocused={onInboxFocused} />
                <ProjectsOverview
                    list={list}
                    onOpen={() => zoom(1)}
                    onRemove={onRemove}
                    summary={(card, part) => <CardSummaries project={card} part={part} />}
                />
            </div>
        );
    }
    if (!tiles) return <WaitingPanels project={project} />;
    // full screen, and a project's one panel at level 1
    if (level === 2 || tiles.side.length === 0) {
        return (
            <div className="flex h-full" style={PROJECT_ZOOM}>
                <PanelTile
                    panel={panel}
                    project={project}
                    target={targetOf(panel.id)}
                    selected
                    show={show}
                    findInFiles={findInFiles}
                />
            </div>
        );
    }
    const { main } = tiles;
    // the side column's tiles not minimized; without them, the main tile takes the whole width
    const side = tiles.side.filter((tile) => !layout.minimized.includes(tile.id));
    return (
        <div className="flex h-full p-2" style={TILES_STYLE}>
            <PanelTile
                panel={main}
                project={project}
                target={targetOf(main.id)}
                selected={main === panel}
                show={show}
                findInFiles={findInFiles}
                tile={MAIN_SIZE}
                onZoomIn={() => zoom(2, main)}
                onSelect={() => select(main)}
            />
            {side.length > 0 ? (
                <SideColumn
                    panels={tiles.side}
                    shown={side}
                    split={layout.split}
                    onSplit={onSplit}
                    tile={(tile, tileFit) => (
                        <PanelTile
                            panel={tile}
                            project={project}
                            target={targetOf(tile.id)}
                            selected={tile === panel}
                            show={show}
                            findInFiles={findInFiles}
                            tile={SIDE_SIZE}
                            tileFit={tileFit}
                            onZoomIn={() => zoom(2, tile)}
                            onMinimize={() => onMinimize(tile)}
                            onSelect={() => select(tile)}
                        />
                    )}
                />
            ) : null}
        </div>
    );
}

/**
 * What a project's panels tell on its card at all projects, from what its folder is: nothing until
 * that is read, which the cards ask without starting a WSL distro.
 */
function CardSummaries({ project, part }: { project: ProjectInfo; part: SummaryPart }) {
    const folderKind = useFolderKind(project, { freshOnShow: true });
    if (folderKind.waiting) return null;
    const repository = folderKind.kind === 'repository';
    return projectTiles(folderKind.kind).summaries.map(({ id, Component }) => (
        <Suspense key={id} fallback={null}>
            <Component project={project} part={part} repository={repository} />
        </Suspense>
    ));
}

/**
 * A project's panels before its folder's kind is read, as they wait for what they read: nothing
 * drawn, but for a WSL project, whose first read may start the distro and Sidekyk's helper in it.
 */
function WaitingPanels({ project }: { project: ProjectInfo }) {
    const { t } = useTranslation();
    const folder = projectFolder(project);
    return (
        <div
            className="flex h-full items-center justify-center text-sm text-ui-text-muted"
            style={PROJECT_ZOOM}
        >
            {folder?.kind === 'wsl' ? t('projects.starting', { distro: folder.distro }) : null}
        </div>
    );
}
