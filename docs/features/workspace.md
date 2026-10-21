# Workspace

The shell around the panels: zoom levels, tiles and sidebars, keys, settings, toasts and
problems. Why semantic zoom: `../product.md`.

## Behaviour

- Breadcrumb (All projects / project / panel) is the only "where am I", in the top bar (macOS
  overlay title bar); its "All projects" goes to level 0.
- Levels: 0 all projects (cards, `projects.md`), 1 a project's panels as tiles, 2 one panel full
  screen. Zoom transitions: View Transitions, 320 ms.
- Tiles are the only level 1 layout (tabs dropped 2026-10-13). Changes on the left keeps 560 px;
  Files above Notes in the side column, which gives way first.
  - Side column (2026-10-17): one width, the tree's, the same setting as full screen (one value,
    as VS Code's sidebar); at least the widest tile shown (Files 160 px, Notes 320 px: cards need
    the room, one width stays). The splitter between Changes and the column drags it, double click
    fits; the splitter between Files and Notes, double click evens.
  - Files and Notes minimize to chips in the top bar; each project keeps its tiles (minimized,
    split), gone with the project.
- Every sidebar resizes the same way (2026-10-17): Changes' list (200 px min, 288 default), Files'
  tree, Notes' lists. Drag; double click fits what it shows, again goes back; the content beside
  keeps 240 px; one width per sidebar, the same in a tile and full screen (`sidebarWidths`).
- Panel headers: in a tile the panel's icon (title and key in its tooltip; 2026-10-17, the title
  repeated what the panel shows), what is open, icon actions; full screen no header when empty.
  Icons from Tabler.
- Copy is one icon everywhere, its tooltip says what it copies, a check once done.
- Toasts for passing events (bottom center, max three; errors stay); lasting problems in the top
  bar, each with its fix (`repository_missing`: Locate…, Remove; a WSL distro gone, no git there,
  the helper not starting: Try again, Remove; a refused global shortcut).
- Theme dark by default, light in settings; no system following.
- Settings: modal (`⌘,`, gear), applies at once: theme, language (`languages.md`), diff view and
  scrollbar width, long lines in code (scroll or wrap), copy template, long lines in notes,
  global shortcut.
- The settings in effect live in one place in memory (`AppliedSettings`), read from the store
  at startup and written back on each change; `get_settings` and the backend's texts read them.
- `set_settings` applies only what differs from the settings in effect (2026-10-21): a sidebar
  dragged or a view preference switched only stores the file; the theme (every window on
  Windows, GTK on Linux) and language are set again only when they change, the shortcut only
  when not registered as asked, and the same settings again do nothing.

## Keys

`⌘` on macOS, `Ctrl` elsewhere.

- `↵`/`Esc` zoom (`Esc` progressive: field, menu, mode, then zoom); `1`-`9` panels; `[`/`]`
  projects; `←`/`→` tiles at level 1 (the selected tile takes `j`/`k`); `⌘`+scroll and pinch
  (macOS) zoom under the pointer.
- `⌘K` / `⌘F` the palette (`search.md`), `⌘,` settings, `⌘N` a new note (`notes.md`).
- `?` (and the top bar's `?`) shows the shortcuts in a card, bottom right: sections with a title
  and a thin line (move around, find, changes and files, notes, app), two columns, 13.5 px.

## How it is built

- `AppShell` owns level, selected tile / full-screen panel and the pending target; every level
  change goes through `zoom` inside a view transition. `preloadable` parts render at once when
  their chunk is loaded, so a transition never captures an empty frame.
- `app/workspace-keys.ts`: `↵`/`Esc`, `1`-`9`, `←`/`→` (tiles), `[`/`]`, `⌘,`, `⌘K`, `⌘F` (also
  inside the palette, to switch mode; a viewer takes it first), `?` (`ShortcutsHelp`, lazy; list
  kept by hand: a new shortcut adds its line). Keys a field, dialog or menu takes are theirs.
  Panels listen with `useWindowKeys`; a panel taking `↵`/`Esc` listens while capturing and the
  workspace skips handled keys.
- `app/zoom-gestures.ts`: the wheel listener exists only while `⌘`/`Ctrl` is held.
- Tiles: `MAIN_TILE` (Changes, fills, keeps 560 px) and `SIDE_TILES` (Files above Notes) in
  `SideColumn`, which owns their width (`SIDE_WIDTH`: the tree's setting, `sidebarWidths.files`),
  at least the widest `tileMinWidth` shown, giving way first. Its splitter's double click fits what
  tiles need (`PanelProps.tileFit`: Files tells its tree's), else goes back to the default. A
  splitter between its tiles (`split`); each tile keeps its place in the tree, so minimizing one
  never remounts the other. Chips use `zoom-panel-*` names: the view transition flies tile and
  chip into each other; `show` to a minimized tile brings it back; ←/→ skip them, `2`/`3` still
  open them full screen.
- Tiles per project (`ProjectList.layouts`, by root: minimized panels, split; `useProjectLayout`,
  `set_project_layout`): shown at once (in the same render, for the view transition), stored
  after (`update_stored`: no watcher or cache touched); a removed project's layout goes with it.
- Sidebar widths: one setting (`sidebarWidths`, by sidebar: `changes`, `files`, `notes`), served
  to every module by `shared/ui/sidebar-width.ts` (`useSidebarWidth`, `SidebarSplitter`); a drag
  stores the width the layout allowed.
- Toasts (`useShowToast`) for failures nothing on screen waits for; Base UI toaster loaded with the
  first one, earlier ones queued. Dialogs show their own errors. A toast may carry an action (Undo:
  done, moved, deleted notes and lists): its own toast, 6 s.
- Problems (`app/problems.ts`) are derived from caches, never fetched; popover loaded with the
  first problem.

## Decisions

- UI components (2026-10-12): Base UI (`@base-ui/react`, pinned 1.8.0) for palette, menus,
  selects, tooltips, toasts: maintained, 1.x, headless, virtualizes with `@tanstack/react-virtual`.
  Compared (kB gzip, palette/tooltip): Base UI 42/34, Radix+cmdk 19.5/21 (Radix slowing, cmdk no
  virtualization), Headless UI 54/none, Ariakit 38/35 (0.x), Ark 48/25, React Aria 56/22.
  Positioning (floating-ui) is the shared 20-35 kB. CSS-only tooltips cannot flip; anchor
  positioning unconfirmed on WebKitGTK. Never in the first paint chunk.
