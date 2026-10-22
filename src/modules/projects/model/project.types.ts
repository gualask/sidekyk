/**
 * Wire contracts with the Rust backend (`src-tauri/crates/core/src/modules/projects/contracts.rs`).
 * Change both sides together.
 */

import type { ProjectInfo } from '@/shared/projects/project-info';

export interface ProjectList {
    /** In the order they were added. */
    projects: ProjectInfo[];
    /** The id of the project on screen: null only when there are no projects. */
    active: string | null;
    /** How each project lays out its panels' tiles, by id; one never changed is not there. */
    layouts: Record<string, TilesLayout>;
}

/**
 * What Locate… did: the project follows its folder's new place, or that folder is another
 * project's, which stays as it is.
 */
export type Relocation =
    | { kind: 'moved'; list: ProjectList }
    | { kind: 'inProject'; id: string; name: string };

/** A project's tiles, as the user left them. */
export interface TilesLayout {
    /** The panels minimized to the top bar, by id. */
    minimized: string[];
    /** The share of the side column the upper tile takes, between 0 and 1. */
    split: number;
}

export const PROJECTS_CHANGED_EVENT = 'projects-changed';

export interface ProjectsChangedEvent {
    version: 1;
}
