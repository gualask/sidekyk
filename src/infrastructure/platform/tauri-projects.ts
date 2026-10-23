import { invoke } from '@tauri-apps/api/core';

import {
    PROJECTS_CHANGED_EVENT,
    type ProjectsChangedEvent,
    type ProjectsPort,
} from '@/modules/projects';
import { onTauriEvent } from './events';

/** Native projects adapter: commands in `src-tauri/src/interfaces/tauri/projects.rs`. */
export const tauriProjects: ProjectsPort = {
    getProjects: () => invoke('get_projects'),
    takeOpenedProject: () => invoke('take_opened_project'),
    addProject: () => invoke('add_project'),
    activateProject: (projectId) => invoke('activate_project', { projectId }),
    removeProject: (projectId) => invoke('remove_project', { projectId }),
    relocateProject: (projectId) => invoke('relocate_project', { projectId }),
    setProjectLayout: (projectId, layout) => invoke('set_project_layout', { projectId, layout }),
    onProjectsChanged: (listener) =>
        onTauriEvent<ProjectsChangedEvent>(PROJECTS_CHANGED_EVENT, () => listener(), listener),
};
