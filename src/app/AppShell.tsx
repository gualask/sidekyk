import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import {
    activeProject,
    loadProjectsOverview,
    NoProjects,
    type ProjectList,
    ProjectRail,
    useActivateProject,
    useProjects,
    useProjectsChangeSubscription,
} from '@/modules/projects';
import {
    ChangeCount,
    changesPanel,
    filesPanel,
    fileTarget,
    useRepositoryChangeSubscription,
    useShownFile,
} from '@/modules/repository';
import { loadCommandPalette, type PaletteActions, type PaletteMode } from '@/modules/search';
import { loadSettingsDialog } from '@/modules/settings';
import { errorMessage } from '@/shared/errors/app-error';
import type { PanelDefinition, PanelProps, PanelTarget } from '@/shared/panels/panel';
import type { ProjectInfo } from '@/shared/projects/project-info';
import { preloadable } from '@/shared/ui/preloadable';
import { whenIdle } from '@/shared/ui/when-idle';
import { ZOOM_NAMES, zoomControlAt, zoomTransition } from '@/shared/ui/zoom-transition';
import { PanelTile } from './PanelTile';
import {
    INITIAL_PANEL,
    PALETTE_PANELS,
    panelById,
    SUMMARIES,
    TILE_GAP,
    TILES,
    tileBeside,
} from './panels';
import { useProblems } from './problems';
import { useShowWindowWhen } from './providers';
import { TopBar } from './TopBar';
import type { ZoomLevel } from './workspace';
import { useWorkspaceKeys } from './workspace-keys';
import { useZoomGestures } from './zoom-gestures';

const ProjectsOverview = preloadable(loadProjectsOverview, (module) => module.ProjectsOverview);
const SettingsDialog = preloadable(loadSettingsDialog, (module) => module.SettingsDialog);
const CommandPalette = preloadable(loadCommandPalette, (module) => module.CommandPalette);

/** Loaded when first asked for: the first paint does not show it. */
const ShortcutsHelp = lazy(() =>
    import('./ShortcutsHelp').then((module) => ({ default: module.ShortcutsHelp })),
);

/** Without a project, the palette offers no panel. */
const NO_PANELS: typeof PALETTE_PANELS = [];

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

/** The window: the top bar, and below it the workspace at its zoom level. */
export function AppShell() {
    useProjectsChangeSubscription();
    useRepositoryChangeSubscription();
    const projects = useProjects();
    // the app opens on the project it showed last, with its panels
    const [level, setLevel] = useState<ZoomLevel>(1);
    // the panel full screen at level 2, and the tile selected at level 1
    const [panel, setPanel] = useState(INITIAL_PANEL);
    // what that panel was asked to show, such as a file picked in the palette
    const [target, setTarget] = useState<Asked | null>(null);
    const project = projects.data ? activeProject(projects.data) : null;
    // the window, created hidden, shows with the workspace laid out, not an empty shell
    useShowWindowWhen(!projects.isPending);
    // what the first paint does not need waits until the window has nothing else to do
    const [idle, setIdle] = useState(false);
    // null until first opened; then the dialogs stay mounted, to give the focus back as they close
    const [settingsOpen, setSettingsOpen] = useState<boolean | null>(null);
    const [palette, setPalette] = useState(PALETTE_UNOPENED);
    const [helpOpen, setHelpOpen] = useState(false);
    const toggleHelp = () => setHelpOpen((open) => !open);
    // the file shown, whose lines found come first: worked out only while the palette is open
    const shownFile = useShownFile(level > 0 ? (project?.root ?? null) : null);
    // a problem's fix in the settings: they open in place of the palette
    const openSettings = useCallback(() => {
        setPalette(closePalette);
        setSettingsOpen(true);
    }, []);
    const problems = useProblems(projects.data, openSettings);
    const activate = useActivateProject();

    /**
     * Every change of level goes through here, so it animates the same way everywhere. A target
     * asks the panel full screen to show something; any other move leaves the panels as they are.
     */
    const zoom = (next: ZoomLevel, nextPanel = panel, nextTarget: PanelTarget | null = null) => {
        const asked = nextTarget ? { panel: nextPanel.id, target: nextTarget } : null;
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

    // a panel shows something in another: the other tile, selected, or full screen in place of
    // the first
    const show: PanelProps['show'] = (id, nextTarget) => {
        const next = panelById(id);
        if (!next) return;
        if (level === 2) {
            zoom(2, next, nextTarget);
            return;
        }
        setPanel(next);
        setTarget({ panel: next.id, target: nextTarget });
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

    const paletteActions: PaletteActions = {
        // the project's panels, or the panel already full screen
        openProject: (root) => {
            activate(root);
            if (level === 0) zoom(1);
        },
        openPanel: (id) => {
            const next = panelById(id);
            if (next) zoom(2, next);
        },
        // as a file picked in the tree: in Files' own viewer when it is full screen, else Changes
        openFile: (path, find) =>
            show(
                level === 2 && panel === filesPanel ? filesPanel.id : changesPanel.id,
                fileTarget(path, null, find ?? null),
            ),
    };

    const zoomIn = () => {
        if (level < 2) zoom((level + 1) as ZoomLevel);
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
            if (level > 0) zoom(2, next);
        },
        // the arrows move among the tiles of a project's panels
        moveTile: (step) => {
            const next = level === 1 ? tileBeside(panel, step) : undefined;
            if (next) setPanel(next);
            return level === 1;
        },
        toggleSettings,
        togglePalette,
        toggleHelp,
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

    // all projects and the settings are a click away: their code is fetched while nothing else
    // happens
    useEffect(
        () =>
            whenIdle(() => {
                setIdle(true);
                void ProjectsOverview.preload();
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
            />
            <main className="min-h-0 flex-1">
                {projects.isError ? (
                    <div className="flex h-full items-center justify-center p-8 text-sm text-ui-danger">
                        {errorMessage(projects.error)}
                    </div>
                ) : projects.data ? (
                    <Workspace
                        list={projects.data}
                        project={project}
                        level={level}
                        panel={panel}
                        target={target}
                        zoom={zoom}
                        select={setPanel}
                        show={show}
                        findInFiles={findInFiles}
                        idle={idle}
                    />
                ) : null}
            </main>
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
                        root={level > 0 ? (project?.root ?? null) : null}
                        currentFile={palette.open ? shownFile() : null}
                        panels={project ? PALETTE_PANELS : NO_PANELS}
                        actions={paletteActions}
                    />
                </Suspense>
            )}
        </div>
    );
}

/** What a panel was asked to show, and which panel. */
interface Asked {
    panel: string;
    target: PanelTarget;
}

function Workspace({
    list,
    project,
    level,
    panel,
    target,
    zoom,
    select,
    show,
    findInFiles,
    idle,
}: {
    list: ProjectList;
    project: ProjectInfo | null;
    level: ZoomLevel;
    /** Full screen at level 2, the selected tile at level 1. */
    panel: PanelDefinition;
    target: Asked | null;
    zoom: (level: ZoomLevel, panel?: PanelDefinition) => void;
    select: (panel: PanelDefinition) => void;
    show: PanelProps['show'];
    findInFiles: PanelProps['findInFiles'];
    /** The first paint is done: the other projects' counts may load. */
    idle: boolean;
}) {
    const targetOf = (id: string) => (target?.panel === id ? target.target : null);
    // also reached from all projects, once the last project is removed there: the repository
    // added next opens, as from the "+ Add a repository" card
    if (!project) return <NoProjects onOpen={() => zoom(1)} />;
    if (level === 0) {
        return (
            <Suspense fallback={null}>
                <ProjectsOverview.Component
                    list={list}
                    onOpen={() => zoom(1)}
                    summary={(card) =>
                        SUMMARIES.map(({ id, Component }) => (
                            <Suspense key={id} fallback={null}>
                                <Component project={card} />
                            </Suspense>
                        ))
                    }
                />
            </Suspense>
        );
    }
    if (level === 2) {
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
    return (
        <div className="flex h-full" style={PROJECT_ZOOM}>
            <ProjectRail
                list={list}
                onShowAll={() => zoom(0)}
                badge={(other) => {
                    // the project on screen gets its count from the Changes panel's snapshot
                    const shown = other.root === project.root;
                    return shown || idle ? (
                        <ChangeCount project={other} fromSnapshot={shown} />
                    ) : null;
                }}
            />
            <div className="flex min-w-0 flex-1 p-2" style={{ gap: TILE_GAP }}>
                {TILES.map((tile) => (
                    <PanelTile
                        key={tile.panel.id}
                        panel={tile.panel}
                        project={project}
                        target={targetOf(tile.panel.id)}
                        selected={tile.panel === panel}
                        show={show}
                        findInFiles={findInFiles}
                        tile={tile}
                        onZoomIn={() => zoom(2, tile.panel)}
                        onSelect={() => select(tile.panel)}
                    />
                ))}
            </div>
        </div>
    );
}
