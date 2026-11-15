/**
 * Where the Changes panel shows the recent commits: at the bottom of its list (`sidebar`, the
 * default), or under the list and the viewer, the panel's whole width (`footer`). A setting
 * (`CommitsPlace` in `src-tauri/crates/core/src/modules/settings/contracts.rs`), chosen from the
 * section itself.
 */
export type CommitsPlace = 'sidebar' | 'footer';
