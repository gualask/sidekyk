/**
 * A repository the user added, identified by its root: what the projects module lists and what a
 * panel shows. Wire contract with the Rust backend (`RepositoryInfo` in
 * `src-tauri/src/modules/repository/contracts.rs`).
 */
export interface ProjectInfo {
    root: string;
    name: string;
}
