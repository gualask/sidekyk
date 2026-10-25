/**
 * How a file that has a preview (Markdown, SVG) shows: as it reads (`preview`) or its text
 * (`code`). A setting chooses the one it opens in (`FileView` in
 * `src-tauri/crates/core/src/modules/settings/contracts.rs`); the viewer's header switches it any
 * time.
 */
export type FileView = 'preview' | 'code';
