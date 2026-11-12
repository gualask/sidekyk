import { invoke } from '@tauri-apps/api/core';

import {
    PROJECTS_CHANGED_EVENT,
    type ProjectsChangedEvent,
    type ProjectsPort,
} from '@/modules/projects';
import { onTauriEvent } from './events';

/** Native projects adapter: commands in `src-tauri/src/interfaces/tauri/projects/`. */
export const tauriProjects: ProjectsPort = {
    getProjects: () => invoke('get_projects'),
    takeOpened: () => invoke('take_opened'),
    chooseProjectFolder: () => invoke('choose_project_folder'),
    createProject: (name, folders) => invoke('create_project', { name, folders }),
    renameProject: (projectId, name) => invoke('rename_project', { projectId, name }),
    activateProject: (projectId) => invoke('activate_project', { projectId }),
    removeProject: (projectId) => invoke('remove_project', { projectId }),
    relocateFolder: (folderId) => invoke('relocate_folder', { folderId }),
    showProjectFolder: (folderId) => invoke('show_project_folder', { folderId }),
    addProjectFolder: (projectId) => invoke('add_project_folder', { projectId }),
    removeProjectFolder: (projectId, folderId) =>
        invoke('remove_project_folder', { projectId, folderId }),
    mergeProjects: (into, from) => invoke('merge_projects', { into, from }),
    setProjectLayout: (projectId, layout) => invoke('set_project_layout', { projectId, layout }),
    onProjectsChanged: (listener) =>
        onTauriEvent<ProjectsChangedEvent>(PROJECTS_CHANGED_EVENT, () => listener(), listener),
};
