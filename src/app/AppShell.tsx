import { Suspense } from 'react';
import {
    activeProject,
    NoProjects,
    useProjects,
    useProjectsChangeSubscription,
} from '@/modules/projects';
import { errorMessage } from '@/shared/errors/app-error';
import { INITIAL_PANEL } from './panels';

/** The panel of the project on screen, or the screen that adds the first project. */
export function AppShell() {
    useProjectsChangeSubscription();
    const projects = useProjects();
    const panel = INITIAL_PANEL;

    if (projects.isPending) return null;
    if (projects.isError) {
        return (
            <div className="flex h-full items-center justify-center p-8 text-sm text-ui-danger">
                {errorMessage(projects.error)}
            </div>
        );
    }
    const project = activeProject(projects.data);
    if (!project) return <NoProjects />;

    return (
        <section className="h-full" aria-label={panel.title} data-panel={panel.id}>
            <Suspense fallback={null}>
                <panel.Component project={project} />
            </Suspense>
        </section>
    );
}
