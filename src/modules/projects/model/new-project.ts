import type { ProjectLocation } from '@/shared/projects/project-info';
import type { FolderChoice, FolderInside } from './project.types';

/** A folder the new project will follow: the path given back, where it is to show. */
export interface PickedFolder {
    path: string;
    location: ProjectLocation;
}

/** A folder picked without git, with repositories right inside it no project has yet. */
export type ParentFolder = Extract<FolderChoice, { kind: 'usable' }>;

/**
 * What a parent of repositories becomes: one project with them (`together`), a project each
 * (`each`), or the folder as it is (`folder`).
 */
export type ParentUse = 'together' | 'each' | 'folder';

/** The repositories inside a folder picked that no project has yet. */
export function freeRepositories(parent: ParentFolder): FolderInside[] {
    return parent.repositories.filter((repository) => repository.inProject === null);
}

/** Whether a folder picked is a parent of repositories to ask about: some of them still free. */
export function isParent(choice: ParentFolder): boolean {
    return freeRepositories(choice).length > 0;
}

/**
 * The folders a parent of repositories brings, as `use` says: its free repositories (in one
 * project, or a project each), or itself.
 */
export function parentFolders(parent: ParentFolder, use: ParentUse): PickedFolder[] {
    if (use === 'folder') return [{ path: parent.path, location: parent.location }];
    return freeRepositories(parent).map(({ path, location }) => ({ path, location }));
}

/** `folders` with `folder` added last, unless a folder of that path is there already. */
export function withFolder(folders: readonly PickedFolder[], folder: PickedFolder): PickedFolder[] {
    return folders.some((f) => f.path === folder.path) ? [...folders] : [...folders, folder];
}
