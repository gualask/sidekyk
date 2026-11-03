/**
 * A project: a name, its notes, and the folders it follows. Wire contract with the Rust backend
 * (`Project` in `src-tauri/crates/core/src/modules/projects/contracts.rs`).
 */
export interface ProjectInfo {
    /**
     * What everything of the project is keyed by. Opaque: compared, never read; kept when its
     * folder moves.
     */
    id: string;
    name: string;
    /** The folders it follows, in the order they were added: none, one, or several on one machine. */
    folders: ProjectFolder[];
}

/**
 * A folder a project follows: where it is, and an id of its own, which its repository's reads name
 * (opaque, as a project's; kept when the folder moves).
 */
export type ProjectFolder = ProjectLocation & { id: string };

/** The folder that places a project, as beside another of the same name: its first, if any. */
export function projectFolder(project: ProjectInfo): ProjectFolder | null {
    return project.folders[0] ?? null;
}

/** A project's one folder; null without folders or with several. */
export function onlyFolder(project: ProjectInfo): ProjectFolder | null {
    return project.folders.length === 1 ? project.folders[0] : null;
}

/**
 * The folder a project shows, `picked` the folder picked of each project (by the project's id):
 * that one, else its only one. null without folders, and with several none picked: entering such
 * a project asks which (`docs/features/project-folders.md`).
 */
export function folderOnScreen(
    project: ProjectInfo,
    picked: Readonly<Record<string, string>>,
): ProjectFolder | null {
    const id = picked[project.id];
    return project.folders.find((folder) => folder.id === id) ?? onlyFolder(project);
}

/** Where a project's folder is: on this machine, or in a WSL distro (`root` a Linux path). */
export type ProjectLocation =
    | { kind: 'local'; root: string }
    | { kind: 'wsl'; distro: string; root: string };
