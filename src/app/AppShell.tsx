import { lazy, Suspense, useEffect, useState } from 'react';
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
import { hasShortcutModifier } from '@/shared/platform/shortcut';
import type { ProjectInfo } from '@/shared/projects/project-info';
import { whenIdle } from '@/shared/ui/when-idle';
import { PanelTile } from './PanelTile';
import { INITIAL_PANEL, SUMMARIES } from './panels';
import { TopBar } from './TopBar';
import type { ZoomLevel } from './workspace';

const ProjectsOverview = lazy(() =>
    loadProjectsOverview().then((module) => ({ default: module.ProjectsOverview })),
);
const SettingsDialog = lazy(() =>
    loadSettingsDialog().then((module) => ({ default: module.SettingsDialog })),
);

/** The window: the top bar, and below it the workspace at its zoom level. */
export function AppShell() {
    useProjectsChangeSubscription();
    useRepositoryChangeSubscription();
    const projects = useProjects();
    // the app opens on the project it showed last, with its panels
    const [level, setLevel] = useState<ZoomLevel>(1);
    const project = projects.data ? activeProject(projects.data) : null;
    // what the first paint does not need waits until the window has nothing else to do
    const [idle, setIdle] = useState(false);
    // null until first opened; then the dialog stays mounted, to give the focus back as it closes
    const [settingsOpen, setSettingsOpen] = useState<boolean | null>(null);

    // all projects and the settings are a click away: their code is fetched while nothing else
    // happens
    useEffect(
        () =>
            whenIdle(() => {
                setIdle(true);
                void loadProjectsOverview();
                void loadSettingsDialog();
                for (const summary of SUMMARIES) void summary.preload();
            }),
        [],
    );

    useEffect(() => {
        function onKeyDown(event: KeyboardEvent) {
            if (!hasShortcutModifier(event) || event.altKey || event.key !== ',') return;
            event.preventDefault();
            setSettingsOpen((open) => !open);
        }
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    return (
        <div className="flex h-full flex-col">
            <TopBar
                level={level}
                project={project}
                panel={INITIAL_PANEL}
                onZoom={setLevel}
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
                        onZoom={setLevel}
                        idle={idle}
                    />
                ) : null}
            </main>
            {settingsOpen === null ? null : (
                <Suspense fallback={null}>
                    <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
                </Suspense>
            )}
        </div>
    );
}

function Workspace({
    list,
    project,
    level,
    onZoom,
    idle,
}: {
    list: ProjectList;
    project: ProjectInfo | null;
    level: ZoomLevel;
    onZoom: (level: ZoomLevel) => void;
    /** The first paint is done: the other projects' counts may load. */
    idle: boolean;
}) {
    // also reached from all projects, once the last project is removed there: the repository
    // added next opens, as from the "+ Add a repository" card
    if (!project) return <NoProjects onOpen={() => onZoom(1)} />;
    if (level === 0) {
        return (
            <Suspense fallback={null}>
                <ProjectsOverview
                    list={list}
                    onOpen={() => onZoom(1)}
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
            <div className="flex h-full">
                <PanelTile panel={INITIAL_PANEL} project={project} />
            </div>
        );
    }
    return (
        <div className="flex h-full">
            <ProjectRail
                list={list}
                onShowAll={() => onZoom(0)}
                badge={(other) => {
                    // the project on screen gets its count from the Changes panel's snapshot
                    const shown = other.root === project.root;
                    return shown || idle ? (
                        <ChangeCount project={other} fromSnapshot={shown} />
                    ) : null;
                }}
            />
            <div className="flex min-w-0 flex-1 p-2">
                <PanelTile panel={INITIAL_PANEL} project={project} onZoomIn={() => onZoom(2)} />
            </div>
        </div>
    );
}
