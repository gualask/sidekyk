# Diagrams

Mermaid diagrams in the preview: a Markdown file's ` ```mermaid ` blocks and `.mmd`/`.mermaid`
files, drawn in the app's colors and font. Nothing a diagram holds runs, nothing leaves the
machine. The other previews: `previews.md`.

## Behaviour

- Markdown: a block's diagram in place of its code, at its own size, narrower to fit the column,
  centered. A click opens it over the preview, filling the panel; `Esc` or × goes back, the focus
  on the diagram again. A source that never read shows as code, the reason under it ("Diagram not
  valid: …", in merman's words).
- `.mmd`, `.mermaid`: "Code | Preview" as Markdown and SVG (Settings, "Open Markdown, SVG and
  diagrams as"); a changed one "Changes | Full file | Preview". Preview: the diagram filling the
  panel.
- The full view: fitted (never past its own size) and centered, fitted again as the panel or the
  diagram changes, until zoomed or moved. `⌘+`, `⌘-`, `⌘0` (fit), the buttons, a pinch or `⌘` and
  the wheel zoom (10% to 800%, a pinch around the pointer); a drag or the wheel moves it. Drawn
  again at each size, so sharp.
- The file written while shown: drawn again. A source that no longer reads keeps the last diagram
  drawn, the reason under it: an agent halfway through writing it.
- Colors: the app's tokens in the theme on screen (`model/preview/diagram-tokens.json`): the preview's
  background, nodes as code blocks, notes as warnings, a series (mind map branches, pie slices,
  git branches) the avatars' colors (`--ui-series-*`). A change of theme draws them again. The
  file's own `style`, `classDef` and `%%{init}%%` win.
- Labels at the preview's text size (14.5 px): Mermaid's main text (16 px, a sequence diagram's
  messages, an architecture's labels) takes it; its smaller sizes (actors, notes, ER attributes)
  and titles stay as Mermaid scales them.
- `click` in a diagram does nothing: it is an image.

## How it is built

- `modules/diagram/` (core, pure): merman on Mermaid's `base` theme, its variables from the tokens
  the frontend sends, each made opaque over the background (Mermaid derives shades from them).
  `render_diagram`, off the async runtime; a source past 200,000 bytes fails, one past 5 s is
  given up. Drawn on the host for a WSL project too: the source is already the frontend's.
- Font: one pair of files, Plus Jakarta Sans's variable TTFs from Google Fonts (`assets/fonts/`,
  SIL OFL 1.1), for the page (`@font-face` in `src/main.css`), the labels' measure (merman reads
  TrueType) and the SVG: each diagram carries them cut to the characters it draws (skera,
  Google's port of HarfBuzz's subsetter, variations kept; the italic only when it draws any) as
  `@font-face` data URLs, since an SVG shown as an image sees none of the page's fonts and loads
  nothing. `foreignObject{overflow:visible}`: a character the font lacks (`⌘`) is drawn from
  another font, wider or narrower than measured, and overflows its box rather than being cut.
- The SVG is sized from its view box (merman's `width="100%"` leaves an image no size of its own)
  and answered with that size, which a block reserves before the image loads.
- The Markdown parser makes a ` ```mermaid ` block a `diagram` block with its source as
  CommonMark reads it (the fence's indentation left out): the frontend rebuilds nothing. Its
  lines have no colors (a fence's code in a language without a grammar keeps the text's color),
  so a source that never drew shows as that text, in a code block's frame.
- Frontend: `useShownDiagram` (keyed by colors and source, never drawn again; the last diagram
  drawn kept while the source does not read), `useDiagramColors` (tokens read once per theme,
  `matchMedia`), `ui/viewer/preview/diagram/` (`DiagramBlock`, `DiagramView` placed by `useDiagramPlacement`,
  `DiagramPane`, which loads with the first diagram file); shown as `<img src="data:image/svg+xml,…">` (CSP `img-src
  data:`). The diagram open over a Markdown preview is its place among the file's diagrams
  (`diagramBlocks`), its source read from the document as the file changes: closed when the file
  no longer has it.
- A block keeps its identity by its place among the diagrams beside it (`kindKeys`), as every
  block of the preview: a diagram written above another takes, while it does not read, the
  last diagram drawn in that place.
- Browser fixtures: `src/infrastructure/fixtures/fixture-files/diagrams.json`, written by the Rust test
  `fixture_diagrams` in both themes from `theme.css` and `diagram-tokens.json`
  (`docs/testing.md`).
- Measured (release, M4, `.local/mermaid-renderers/`): 1-7 ms a diagram of the corpus, 40 ms a
  flowchart of 150 nodes, the font's cut (0.2-1.2 ms) included; 22-75 KB a small diagram's SVG,
  25-55 KB of it the font; the WebContent process 56 MB with ten diagrams shown (30 MB empty).

## Decisions

- merman over mermaid.js in the webview: mermaid 12 needs the DOM, so 60-740 ms on the page's
  thread and 116-439 MB of WebContent for one diagram (empty page 30 MB). Mermaid 13 runs without
  a DOM, in a worker, but is an alpha with 9 diagram types: to watch. beautiful-mermaid draws 5
  types; mermaid-rs-renderer takes 388 ms on a flowchart of 60 nodes and fails class diagrams.
- merman pinned (`=0.9.3`): its API changes between minor versions. Without ELK (EPL-2.0), the
  layout merman's default features add.
- An image, not inline SVG: nothing in it runs, as an SVG file's preview; no
  `dangerouslySetInnerHTML`.
- Labels measured with the font drawn: merman's default measure is a heuristic, which an image
  cuts at the box's edge ("RepositoryBack"). Not taken: the system's fonts through merman
  (`system-fonts`: 2.6 s and 484 MB to load 748 faces); its raster-safe pipeline (labels as SVG
  text, 10-15x slower, still cut); Arial embedded (2 MB a diagram).
- The font cut per diagram, not carried whole: 137 KB of woff2 (Latin, Latin Extended) a diagram,
  in a second set of files than the measured TTF, which could drift apart. Not taken: `subsetter`
  (its subsets are for PDFs only, by its README); `fontcull` (a fork of skera's code, C++ for
  woff2); woff2 made from the TTF with fonttools (a Python tool to make them again, the font
  whole in each diagram).

## Sources

- [merman](https://github.com/Latias94/merman) (MIT or Apache-2.0); the
  [Mermaid v13 alpha](https://mermaid.js.org/intro/v13-alpha.html);
  [Mermaid theming](https://mermaid.js.org/config/theming.html) (the `base` theme's variables);
  [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid);
  [mermaid-rs-renderer](https://github.com/1jehuang/mermaid-rs-renderer).
- [Plus Jakarta Sans](https://github.com/tokotype/PlusJakartaSans) (SIL OFL 1.1).
