export { type ProjectsPort, ProjectsProvider } from './application/projects.port';
export {
    activeProject,
    useProjects,
    useProjectsChangeSubscription,
} from './application/projects.queries';
export {
    PROJECTS_CHANGED_EVENT,
    type ProjectInfo,
    type ProjectList,
    type ProjectsChangedEvent,
} from './model/project.types';
export { NoProjects } from './ui/NoProjects';
export { ProjectRail } from './ui/ProjectRail';

/** Level 0, loaded on its first show: it brings the menu component along. */
export const loadProjectsOverview = () => import('./ui/ProjectsOverview');
