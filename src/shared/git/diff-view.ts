/**
 * The view a diff shows: only the changed lines (`changes`), or the whole file with its changes
 * marked (`file`). A setting chooses the one a diff opens in (`DiffView` in
 * `src-tauri/crates/core/src/modules/settings/contracts.rs`); the diff's header switches it any
 * time.
 */
export type DiffView = 'changes' | 'file';
