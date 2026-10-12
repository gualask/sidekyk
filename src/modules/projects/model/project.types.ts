/**
 * Wire contracts with the Rust backend (`src-tauri/src/modules/projects/contracts.rs`).
 * Change both sides together.
 */

import type { ProjectInfo } from '@/shared/projects/project-info';

export interface ProjectList {
    /** In the order they were added. */
    projects: ProjectInfo[];
    /** The root of the project on screen: null only when there are no projects. */
    active: string | null;
}

export const PROJECTS_CHANGED_EVENT = 'projects-changed';

export interface ProjectsChangedEvent {
    version: 1;
}
