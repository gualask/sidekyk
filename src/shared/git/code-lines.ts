/**
 * How the viewer shows a line of code longer than its width, in diffs and files alike: on one
 * row, scrolled sideways (`scroll`, the default, as in VS Code and Zed), or wrapped at the edge
 * (`wrap`). A setting (`CodeLines` in `src-tauri/crates/core/src/modules/settings/contracts.rs`).
 */
export type CodeLines = 'scroll' | 'wrap';
