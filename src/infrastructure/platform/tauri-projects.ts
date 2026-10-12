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
    addProject: () => invoke('add_project'),
    activateProject: (root) => invoke('activate_project', { root }),
    removeProject: (root) => invoke('remove_project', { root }),
    onProjectsChanged: (listener) =>
        onTauriEvent<ProjectsChangedEvent>(PROJECTS_CHANGED_EVENT, () => listener()),
};
