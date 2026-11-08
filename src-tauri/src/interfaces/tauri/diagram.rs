//! Mermaid diagrams for the preview: a Markdown file's ` ```mermaid ` block, or a `.mmd` file.

use sidekyk_core::modules::diagram::{render_diagram as render, Diagram, DiagramRequest};
use sidekyk_core::shared::error::AppError;

use super::blocking::blocking;

#[tauri::command]
/// A diagram's source drawn in the app's colors, off the async runtime. Drawn here even for a WSL
/// project: the text is already the frontend's, and the font is the app's.
pub(crate) async fn render_diagram(
    app: tauri::AppHandle,
    request: DiagramRequest,
) -> Result<Diagram, AppError> {
    blocking("render_diagram", app, move |_| render(&request)).await
}
