export { type ProjectsPort, ProjectsProvider } from './application/projects.port';
export {
    DEFAULT_TILES_LAYOUT,
    useActivateProject,
    useProjectLayout,
    useProjects,
    useProjectsChangeSubscription,
    useRelocateProject,
    useRemoveProject,
} from './application/projects.queries';
export {
    type FolderChoice,
    PROJECTS_CHANGED_EVENT,
    type ProjectList,
    type ProjectsChangedEvent,
    type TilesLayout,
} from './model/project.types';
export { activeProject, neighbourProject } from './model/project-list';
export { ProjectsOverview } from './ui/ProjectsOverview';
