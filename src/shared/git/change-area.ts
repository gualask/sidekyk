/**
 * Where a change sits: staged, not staged, or in a file git does not track yet. The backend's
 * `ChangeArea` on the wire (`src-tauri/crates/core/src/modules/repository/contracts.rs`).
 */
export type ChangeArea = 'staged' | 'unstaged' | 'untracked';

/** How the UI names an area next to a file. */
export const CHANGE_AREA_LABEL: Record<ChangeArea, string> = {
    unstaged: 'Not staged',
    untracked: 'New file',
    staged: 'Staged',
};
