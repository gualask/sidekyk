# Workspace

The shell around the panels: zoom levels, tiles and sidebars, keys, settings, toasts and
problems. Why semantic zoom: `../product.md`.

## Behaviour

- Levels: 0 all projects (the Inbox, `notes.md`, and the cards, `projects.md`), 1 a project's
  panels as tiles, 2 one panel full screen; View Transitions, 320 ms. The breadcrumb (All projects
  / project / panel) in the top bar is the only "where am I".
- Start (2026-10-23): level 0, the project shown last selected; `sidekyk <folder>` opens its
  project at level 1.
- Panels from the project (2026-10-23, 2026-10-24): a repository has Changes, Files and Notes; a
  folder without git Files (the main tile, its own viewer) and Notes; no folder, Notes only, shown
  at level 1 as full screen and with no level 2 (`↵`, zooming in and `1`-`9` do nothing). The top
  bar's facts only for a repository. `git init` or `.git` removed switches the panels at the level
  shown. A stopped WSL distro: `wsl.md`. Until the kind is read, nothing is drawn.
- Level 0 in a narrow window: the cards give way first, down to one column (300 px), then the Inbox
  down to 320 px; the window's least width (760 px) fits both.
- Tiles, the only level 1 layout (tabs dropped 2026-10-13): the main tile on the left keeps 560 px;
  Files above Notes in the side column, which gives way first. The column has one width, the
  tree's (as VS Code's sidebar), at least the widest tile shown (Files 160 px, Notes 320 px). Its
  splitter's double click fits; the one between Files and Notes evens them. Files and Notes
  minimize to chips in the top bar; each project keeps its tiles.
- Sidebars resize alike (2026-10-17): Changes' list (200 px min, 288 default), Files' tree, Notes'
  lists, the Inbox (320 px min, 40% of the window until dragged). Double click fits what it shows,
  again goes back; the content beside keeps 240 px; one width per sidebar, in a tile and full
  screen.
- Panel headers: in a tile the icon (title and key in its tooltip), what is open, icon actions;
  full screen no header when empty. Icons from Tabler. Copy is one icon everywhere, its tooltip
  says what it copies.
- Toasts for passing events (bottom center, at most three; errors stay); lasting problems in the
  top bar, each with its fix.
- Settings: a modal (`⌘,`), applied at once: theme (dark by default, no system following),
  language (`languages.md`), diff view and scrollbar width, long lines in code and in notes, copy
  template, how Markdown and SVG open (`previews.md`), global shortcut.

## Keys

`⌘` on macOS, `Ctrl` elsewhere.

- `↵`/`Esc` zoom (`Esc` first closes a field, menu or mode); `1`-`9` panels; `[`/`]` projects;
  `←`/`→` tiles at level 1 (the selected tile takes `j`/`k`); `⌘`+scroll and pinch (macOS) zoom
  under the pointer.
- `⌘K` / `⌘F` the palette (`search.md`), `⌘,` settings, `⌘N` a new note: the project's Notes at
  levels 1 and 2, the Inbox at level 0.
- `?` shows the shortcuts in a card, bottom right: sections with a title, two columns.

## How it is built

- `AppShell` owns the level, the selected tile or full-screen panel and the pending target; every
  level change goes through `zoom` in a view transition. The level shown is as deep as the project
  goes; another project opens at the level seen. A target (`⌘N`, a file from the palette) names its
  project, so a switch leaves it behind. Level 0 composes `InboxColumn` and `ProjectsOverview`,
  both in the first chunk. Panel chunks start loading in `main.tsx`, before the first render. A
  `preloadable` part, shown by `Preloaded`, renders at once once loaded, so a transition never
  captures an empty frame. `Preloaded` is one component at module level (2026-10-31): a factory
  defining one fails Biome's `noComponentHookFactories` (React's `component-hook-factories`).
- Start at level 1: the backend keeps the project the folder argument opened
  (`ProjectsState::opened`) and says the list changed; the frontend takes it once
  (`take_opened_project`). `onProjectsChanged` also runs once as listening starts, so a change made
  before is not missed.
- Panels (`app/panels.ts`): each says what it needs (`PanelDefinition.needs`: Changes a repository,
  Files a folder, Notes nothing); `projectTiles(kind)` gives a project's panels, the first the main
  tile, with its card's summaries and what opens full screen. A panel asked for that the project
  lacks gives way to its main one.
- Keys: `app/workspace-keys.ts`; keys a field, dialog or menu takes are theirs; panels listen with
  `useWindowKeys`, and the workspace skips handled keys. The shortcuts card (`ShortcutsHelp`, lazy)
  is kept by hand. The wheel listener exists only while `⌘`/`Ctrl` is held.
- Tiles: `SideColumn` owns the column's width (`sidebarWidths.files`); a splitter's double click
  fits what tiles report (`PanelProps.tileFit`). Each tile keeps its place in the tree, so
  minimizing one never remounts the other; chips share `zoom-panel-*` names with their tiles for
  the view transition. Per project (`ProjectList.layouts`, `set_project_layout`): shown in the same
  render, stored after.
- Sidebar widths: one setting (`sidebarWidths`: `changes`, `files`, `notes`, `inbox`) through
  `shared/ui/sidebar-width.ts`; a drag stores the width the layout allowed.
- Settings in effect: one copy in memory (`AppliedSettings`), read at startup, written on each
  change. `set_settings` applies only what differs (2026-10-21): theme and language set again only
  when changed, the shortcut only when not registered as asked; a dragged sidebar only writes the
  file.
- Toasts (`useShowToast`) only for failures nothing on screen waits for; Base UI's toaster loads
  with the first. A toast with an action (Undo) stays 6 s. Dialogs show their own errors. Problems
  (`app/problems.ts`) are derived from caches, never fetched.

## Decisions

- Base UI (`@base-ui/react`, pinned to an exact version, 2026-10-12) for palette, menus,
  selects, tooltips, toasts: maintained, headless, virtualizes with `@tanstack/react-virtual`.
  Compared (kB gzip, palette/tooltip): Base UI 42/34, Radix+cmdk 19.5/21 (Radix slowing, cmdk
  not virtualized), Headless UI 54/none, Ariakit 38/35 (0.x), Ark 48/25, React Aria 56/22.
  CSS-only tooltips cannot flip. Never in the first paint chunk.
- Panel icon in a tile, not its title (2026-10-17): the title repeated what the panel shows.
