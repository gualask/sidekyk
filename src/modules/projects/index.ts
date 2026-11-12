export { useFolderOnScreen, useRelocateFolder } from './application/project-folders';
export { DEFAULT_TILES_LAYOUT, useProjectLayout } from './application/project-layout';
export { type ProjectsPort, ProjectsProvider } from './application/projects.port';
export {
    useActivateProject,
    useCurrentProjects,
    useProjects,
    useProjectsChangeSubscription,
    useRemoveProject,
} from './application/projects.queries';
export {
    type FolderChoice,
    type Opened,
    PROJECTS_CHANGED_EVENT,
    type ProjectList,
    type ProjectsChangedEvent,
    type TilesLayout,
} from './model/project.types';
export { activeProject, neighbourProject } from './model/project-list';
export { ProjectsOverview } from './ui/ProjectsOverview';

/** A project's name and folders, to change; loaded with its first opening. */
export const loadEditProjectDialog = () => import('./ui/EditProjectDialog');
