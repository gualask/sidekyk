# Plan: previews

Files shown as they read, in the file viewer (`../features/files.md`), beside their text. High
level, agreed 2026-10-22; details when it is built.

## Design

- A switch "Code | Preview" in the viewer's header for files that have one, as GitHub's, next to
  "Changes | Full file".
- Never runs what a file holds.
- Markdown: images and links relative to the file stay in the project (a linked file opens in the
  viewer), others open in the browser; raw HTML not run; code blocks colored by `syntect`.
- Images: in place of the binary notice.
- PDF: not built into every webview (WebKitGTK, to verify), so likely pdf.js loaded on demand.

## Open

- Which mode a file opens in: Preview without git and Code with git, or the last one chosen.
- Markdown renderer: Rust (`pulldown-cmark`, `comrak`; `ammonia` to clean HTML) or the frontend;
  candidates compared before adding one.
- Note cards stay plain text (`../features/notes.md`), even with a renderer in the app.
