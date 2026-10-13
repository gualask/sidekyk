import { Suspense, useEffect, useState } from 'react';
import { ChangeCount, useRepositoryChangeSubscription } from '@/modules/changes';
import {
    activeProject,
    loadProjectsOverview,
    NoProjects,
    type ProjectList,
    ProjectRail,
    useProjects,
    useProjectsChangeSubscription,
} from '@/modules/projects';
import { loadSettingsDialog } from '@/modules/settings';
import { errorMessage } from '@/shared/errors/app-error';
import type { PanelDefinition } from '@/shared/panels/panel';
import type { ProjectInfo } from '@/shared/projects/project-info';
import { preloadable } from '@/shared/ui/preloadable';
import { whenIdle } from '@/shared/ui/when-idle';
import { ZOOM_NAMES, zoomControlAt, zoomTransition } from '@/shared/ui/zoom-transition';
import { PanelTile } from './PanelTile';
import { INITIAL_PANEL, SUMMARIES } from './panels';
import { TopBar } from './TopBar';
import type { ZoomLevel } from './workspace';
import { useWorkspaceKeys } from './workspace-keys';
import { useZoomGestures } from './zoom-gestures';

const ProjectsOverview = preloadable(loadProjectsOverview, (module) => module.ProjectsOverview);
const SettingsDialog = preloadable(loadSettingsDialog, (module) => module.SettingsDialog);

/** A project and its panels, at level 1 or full screen: the zoom carries it to and from its card. */
const PROJECT_ZOOM = { viewTransitionName: ZOOM_NAMES.project };

/** The window: the top bar, and below it the workspace at its zoom level. */
export function AppShell() {
    useProjectsChangeSubscription();
    useRepositoryChangeSubscription();
    const projects = useProjects();
    // the app opens on the project it showed last, with its panels
    const [level, setLevel] = useState<ZoomLevel>(1);
    // the panel full screen at level 2
    const [panel, setPanel] = useState(INITIAL_PANEL);
    const project = projects.data ? activeProject(projects.data) : null;
    // what the first paint does not need waits until the window has nothing else to do
    const [idle, setIdle] = useState(false);
    // null until first opened; then the dialog stays mounted, to give the focus back as it closes
    const [settingsOpen, setSettingsOpen] = useState<boolean | null>(null);

    /** Every change of level goes through here, so it animates the same way everywhere. */
    const zoom = (next: ZoomLevel, nextPanel = panel) => {
        if (next === level && nextPanel === panel) return;
        zoomTransition(() => {
            setLevel(next);
            setPanel(nextPanel);
        });
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
        toggleSettings: () => setSettingsOpen((open) => !open),
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
                onZoom={zoom}
                onOpenSettings={() => setSettingsOpen(true)}
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
                        zoom={zoom}
                        idle={idle}
                    />
                ) : null}
            </main>
            {settingsOpen === null ? null : (
                <Suspense fallback={null}>
                    <SettingsDialog.Component open={settingsOpen} onOpenChange={setSettingsOpen} />
                </Suspense>
            )}
        </div>
    );
}

function Workspace({
    list,
    project,
    level,
    panel,
    zoom,
    idle,
}: {
    list: ProjectList;
    project: ProjectInfo | null;
    level: ZoomLevel;
    panel: PanelDefinition;
    zoom: (level: ZoomLevel, panel?: PanelDefinition) => void;
    /** The first paint is done: the other projects' counts may load. */
    idle: boolean;
}) {
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
                <PanelTile panel={panel} project={project} />
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
            <div className="flex min-w-0 flex-1 p-2">
                <PanelTile
                    panel={INITIAL_PANEL}
                    project={project}
                    onZoomIn={() => zoom(2, INITIAL_PANEL)}
                />
            </div>
        </div>
    );
}
