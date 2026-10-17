export { type ProjectsPort, ProjectsProvider } from './application/projects.port';
export {
    DEFAULT_TILES_LAYOUT,
    useActivateProject,
    useProjectLayout,
    useProjects,
    useProjectsChangeSubscription,
    useRemoveProject,
} from './application/projects.queries';
export {
    PROJECTS_CHANGED_EVENT,
    type ProjectList,
    type ProjectsChangedEvent,
    type TilesLayout,
} from './model/project.types';
export { activeProject, neighbourProject } from './model/project-list';
export { NoProjects } from './ui/NoProjects';
export { ProjectRail } from './ui/ProjectRail';

/** Level 0, loaded on its first show: it brings the menu component along. */
export const loadProjectsOverview = () => import('./ui/ProjectsOverview');
