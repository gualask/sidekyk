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
    /** The folders it follows: none, or one repository. */
    folders: ProjectLocation[];
}

/** The folder a project follows, if any. */
export function projectFolder(project: ProjectInfo): ProjectLocation | null {
    return project.folders[0] ?? null;
}

/** Where a project's folder is: on this machine, or in a WSL distro (`root` a Linux path). */
export type ProjectLocation =
    | { kind: 'local'; root: string }
    | { kind: 'wsl'; distro: string; root: string };
