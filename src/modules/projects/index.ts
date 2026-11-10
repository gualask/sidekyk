export { type ProjectsPort, ProjectsProvider } from './application/projects.port';
export {
    DEFAULT_TILES_LAYOUT,
    useActivateProject,
    useCurrentProjects,
    useFolderOnScreen,
    useProjectLayout,
    useProjects,
    useProjectsChangeSubscription,
    useRelocateFolder,
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
