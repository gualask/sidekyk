/**
 * A repository the user added, and where it is. Wire contract with the Rust backend (`Project` in
 * `src-tauri/crates/core/src/modules/projects/contracts.rs`).
 */
export interface ProjectInfo {
    /** What everything of the project is keyed by. Opaque: compared, never read. */
    id: string;
    name: string;
    location: ProjectLocation;
}

/** Where a project's repository is: on this machine, or in a WSL distro (`root` a Linux path). */
export type ProjectLocation =
    | { kind: 'local'; root: string }
    | { kind: 'wsl'; distro: string; root: string };
