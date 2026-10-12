import { lazy, Suspense, useEffect, useState } from 'react';
import {
    activeProject,
    loadProjectsOverview,
    NoProjects,
    type ProjectInfo,
    type ProjectList,
    ProjectRail,
    useProjects,
    useProjectsChangeSubscription,
} from '@/modules/projects';
import { errorMessage } from '@/shared/errors/app-error';
import { whenIdle } from '@/shared/ui/when-idle';
import { PanelTile } from './PanelTile';
import { INITIAL_PANEL } from './panels';
import { TopBar } from './TopBar';
import type { ZoomLevel } from './workspace';

const ProjectsOverview = lazy(() =>
    loadProjectsOverview().then((module) => ({ default: module.ProjectsOverview })),
);

/** The window: the top bar, and below it the workspace at its zoom level. */
export function AppShell() {
    useProjectsChangeSubscription();
    const projects = useProjects();
    // the app opens on the project it showed last, with its panels
    const [level, setLevel] = useState<ZoomLevel>(1);
    const project = projects.data ? activeProject(projects.data) : null;

    // all projects is a click away: its code is fetched while nothing else happens
    useEffect(() => whenIdle(() => void loadProjectsOverview()), []);

    return (
        <div className="flex h-full flex-col">
            <TopBar level={level} project={project} panel={INITIAL_PANEL} onZoom={setLevel} />
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
                    />
                ) : null}
            </main>
        </div>
    );
}

function Workspace({
    list,
    project,
    level,
    onZoom,
}: {
    list: ProjectList;
    project: ProjectInfo | null;
    level: ZoomLevel;
    onZoom: (level: ZoomLevel) => void;
}) {
    // also reached from all projects, once the last project is removed there: the repository
    // added next opens, as from the "+ Add a repository" card
    if (!project) return <NoProjects onOpen={() => onZoom(1)} />;
    if (level === 0) {
        return (
            <Suspense fallback={null}>
                <ProjectsOverview list={list} onOpen={() => onZoom(1)} />
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
            <ProjectRail list={list} onShowAll={() => onZoom(0)} />
            <div className="flex min-w-0 flex-1 p-2">
                <PanelTile panel={INITIAL_PANEL} project={project} onZoomIn={() => onZoom(2)} />
            </div>
        </div>
    );
}
