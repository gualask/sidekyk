/**
 * Wire contracts with the Rust backend (`src-tauri/crates/core/src/modules/projects/contracts.rs`).
 * Change both sides together.
 */

import type { ProjectInfo, ProjectLocation } from '@/shared/projects/project-info';

export interface ProjectList {
    /** In the order they were added. */
    projects: ProjectInfo[];
    /** The id of the project on screen: null only when there are no projects. */
    active: string | null;
    /** How each project lays out its panels' tiles, by id; one never changed is not there. */
    layouts: Record<string, TilesLayout>;
}

/**
 * What a folder picked for a project did (Locate…, Add folder…): the project follows it, or that
 * folder is another project's, which stays as it is.
 */
export type FolderChange =
    | { kind: 'changed'; list: ProjectList }
    | { kind: 'inProject'; id: string; name: string };

/**
 * A folder picked for a new project: one no project has yet (`path` as picked, given back to create
 * the project; `name` its folder's, inside a repository the repository's), with the repositories
 * right inside it when it is a folder without git; or another project's.
 */
export type FolderChoice =
    | {
          kind: 'usable';
          path: string;
          name: string;
          location: ProjectLocation;
          repositories: FolderInside[];
      }
    | { kind: 'inProject'; id: string; name: string };

/**
 * A repository right inside a folder picked: its path, given back to create a project; its name
 * and place; the name of the project that has it already, if any.
 */
export interface FolderInside {
    path: string;
    name: string;
    location: ProjectLocation;
    inProject: string | null;
}

/**
 * What a folder given on the command line did, taken once: a project put on screen with the folder
 * to show, or a folder above repositories to ask about in the New project dialog.
 */
export type Opened =
    | { kind: 'project'; id: string; folderId: string }
    | { kind: 'choice'; choice: FolderChoice };

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
