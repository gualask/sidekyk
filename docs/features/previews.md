# Previews

Files shown as they read in the viewer: Markdown, SVG, images (built 2026-10-25). Nothing a file
holds runs, nothing leaves the machine.

## Behaviour

- Markdown (`.md`, `.markdown`, `.mdown`, `.mkd`, `.mkdn`) and SVG: "Code | Preview" in the
  viewer's header, as "Changes | Full file" for a diff. Images (`.png`, `.jpg`, `.jpeg`, `.gif`,
  `.webp`, `.bmp`, `.ico`): the image in place of the binary notice, pixel size and file size
  below it, at most 16 MB. AVIF left out until WebKitGTK's support is checked.
- Opens as Settings say ("Open Markdown and SVG as", Preview by default); the header's choice
  holds for the panel's files while the app runs and the setting stays. A changed file with a
  preview: "Changes | Full file | Preview", Preview showing the working tree's version, nothing
  marked; a deleted file has none.
- A switch keeps the place: the code opens on the line of the block at the top, the preview on
  the block holding the code's top line. `⌘F` in a preview opens the code with its find bar from
  that line. A selection copies as plain text.
- The file written while shown: the preview reads again, scroll kept; blocks keep their elements
  (keyed by kind and rank), so images are not read again.
- Markdown: CommonMark with GitHub's tables, task lists, strikethrough, footnotes (gathered last,
  numbered by first reference, links back) and alerts (`> [!NOTE]`…, titles from the catalogs);
  a YAML front matter hidden. Headings take GitHub's slugs, prefixed `user-content-` (no id of the
  app's own, `#root`, is ever taken). Code blocks colored as the file's own lines.
- Raw HTML dropped, but `<br>`; the text between inline tags stays. Bare URLs stay text.
- Links: `#heading` scrolls; a relative path (from the file's folder, `/` from the root) to a
  file of the tree opens it in the viewer, at `#heading` if given; one not in the tree is text
  with a tooltip; `http`, `https`, `mailto` open in the system's browser or mail app; any other
  scheme is text. Images: files of the tree, `data:image/`; remote ones never load, their
  description in place, a click opens them in the browser.

## How it is built

- `modules/preview/` (core, pure): `parse_markdown` turns pulldown-cmark's events and byte ranges
  into blocks with their file line (`contracts.rs`), nested at most 48 deep (deeper tags left out,
  their text kept). Targets resolved there (`targets.rs`): anchors, files of the tree, missing
  paths, web, `data:image/`; never above the root. Code lines carry the file's whole line and
  where the code starts, so `lineCheck` and the colors are the file's.
- Read where the tree is: `Repositories::markdown_preview` (the helper parses for a WSL project);
  `get_markdown_preview`, null when the file is not text.
- Images: `project-file://localhost/<projectId>/<path>` (`http://project-file.localhost/…` on
  Windows; `interfaces/tauri/project_file.rs`), an asynchronous URI scheme off the main thread:
  the tree, an image's extension, `MAX_IMAGE_BYTES`; answered with its type, `nosniff`, a policy
  allowing no script, a year's cache. The URL carries the file's stamp (`get_file_stamp`: size,
  mtime), so a changed file is another URL. CSP: `img-src 'self' data: project-file:
  http://project-file.localhost`. Through the helper the bytes follow their message as a raw frame
  (`wsl.md`).
- Links outside: `open_url` (`interfaces/tauri/links.rs`) allows `http`, `https`, `mailto` only,
  through `tauri-plugin-opener`. The window never navigates away from the app's page
  (`on_navigation`) nor opens another (`on_new_window` denies).
- Frontend: `PreviewPane` (lazy `MarkdownPreview`, or `ImageView`), one component with a switch on
  the node's kind; top-level blocks virtualized and measured (`@tanstack/react-virtual`); every
  element is ours, so no `dangerouslySetInnerHTML`. Code blocks ask `useSyntaxColors` for the
  blocks of lines on screen.
- Measured (release, M4): parse plus JSON of Zed's `all-settings.md` (144 KB) 2.9 ms; a 2 MiB
  file 37 ms, 41 MB peak, 5 MB of JSON; a README 0.05 ms (`.local/markdown-renderers/`).

## Decisions (2026-10-25)

- `pulldown-cmark` over `comrak` (3x slower, twice the memory: 37 ms and 29 MB against 11.6 ms and
  13 MB on 2 MiB) once the frontend renders a tree: comrak's safe HTML writer goes unused.
  `markdown-rs` out: panics on Zed's docs, 6 s on 50,000 nested brackets. `markdown-it` in the
  WebView out: heavy work stays in Rust.
- A tree, not HTML: Biome refuses `dangerouslySetInnerHTML`, and links, images and code are our
  components anyway. `hast-util-to-jsx-runtime` not taken (it saves only the one-line cases, for
  ~10 bundled packages); its ideas taken: prefixed ids, footnotes at the end, a scheme
  allowlist, table alignment by style, stable keys.
- Preview by default: Sidekyk only reads, so editors' text first (VS Code, Zed's
  `open_markdown_files_in_preview: false`) does not carry over.
- Raw HTML omitted but `<br>`: in 288 of 993 crate READMEs, mostly remote badges and links;
  a subset (`ammonia`) if READMEs read badly in use.
- Remote images never loaded: the app's first network access, and it tells the host who reads.
- Images through a URI scheme, not bytes over IPC into a blob: no copy in the JS heap, no object
  URL to revoke; through the helper a raw frame, not base64.
- Bare URLs as text: pulldown-cmark has no GFM autolink literal; no detection of our own until
  READMEs read badly without it.
- A changed file's Preview shows the working tree, nothing marked; rendered diffs later.

## Sources

- [pulldown-cmark](https://github.com/pulldown-cmark/pulldown-cmark), raw HTML printed as is
  (`html.rs:122`); [comrak](https://github.com/kivikakk/comrak) (`html/anchorizer.rs`,
  `scanners.re`); crates.io (`crates/crates_io_markdown`, comrak with ammonia).
- [react-markdown](https://github.com/remarkjs/react-markdown) (`defaultUrlTransform`),
  `mdast-util-to-hast` (`clobberPrefix`, footnotes), `hast-util-to-jsx-runtime`.
- VS Code: [Markdown preview security](https://code.visualstudio.com/docs/languages/markdown);
  Zed: `assets/settings/default.json:127`.
