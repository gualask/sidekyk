# Architecture

Tauri 2 app: React/Vite frontend in `src/`, Rust backend in `src-tauri/`, a modular monolith as
in Fyler.

## Data flow

```text
agent edits files ─▶ watcher of the project on screen (notify, 250 ms quiet period)
                       └─▶ hidden window: batch dropped, project only marked
                       └─▶ paths git ignores skipped (check-ignore, cached per directory)
                       └─▶ "repository-changed" { version: 1, root, gitDir }
                             └─▶ frontend invalidates ['repository', root, …]
                                 (recent commits only when gitDir: index, HEAD, refs)
                                   ├─▶ get_repository_snapshot   status + numstat ×3, with summary
                                   ├─▶ get_repository_summary    level 0 only (no snapshot there)
                                   ├─▶ get_file_diff             one file, one area
                                   ├─▶ get_recent_commits        only while unfolded
                                   ├─▶ get_directory             each open folder, from memory
                                   └─▶ get_file_content          the unchanged file shown
```

- A commit's files and diffs (`get_commit_files`, `get_commit_file_diff`) never change: cached
  under `['commit', …]`, read once.
- Commands name a project by its root; the backend serves only roots in the project list.
- Projects not on screen: not watched; their summary is read after the first paint, when the
  window shows again and when level 0 shows, only if older than 30 s.
- Window hidden, minimized or covered (WKWebView follows occlusion): no git. The page reports
  `visibilitychange` (`set_window_visible`); showing again returns the marked project, and the
  frontend reads it plus anything on screen older than 30 s.

## Frontend

### Directory map

- `app/`: composition root: providers, shell (top bar, zoom levels, tiles), keyboard and zoom
  gestures, panel list (`panels.ts`).
- `modules/projects/`: project list, rail, level 0 cards (lazy chunk with Base UI's menu), empty
  screen.
- `modules/settings/`: settings queries and dialog (lazy chunk).
- `modules/search/`: palette (lazy chunk), by name (`⌘K`) or in contents (`⌘F`,
  `useContentSearch`: 150 ms pause, results kept until the next text's first files); ranking and
  reading are the backend's; the app decides what an item opens (`PaletteActions`).
- `modules/repository/`: the repository on screen as two panels (`panel.ts`): Changes (review
  and the viewer of any file) and Files (the tree).
  - `model/`: wire types, diff parser, whole-file hunks, copy format, file grouping, tree rows and
    keys (`file-tree.ts`), the shared selection (`selection.ts`), panel targets (`targets.ts`),
    matches of the find bar (`find.ts`).
  - `application/`: `RepositoryPort`, TanStack Query hooks, commit view, session state
    (`useSelectedFile` for the shared selection),
    `useShownTarget`, `useFileFind` (the find bar's text, per project), `RepositorySettings`
    (what the app passes from the settings).
  - `ui/`: `ChangesWorkspace`, `FilesWorkspace`, `FileTree` (+ `tree-layout.ts`), the viewer
    `Pane` (rows, copy, current hunk, `FindBar`) under `ChangeDiffView`, `CommitDiffView`, `TextFileView`,
    one `FileHeader`, recent commits, summary views (breadcrumb facts, rail count, level 0 card).
    Lists, tree and diff are virtualized flat lists of fixed-height rows.
- `modules/notes/`: the Notes panel (`NotesWorkspace`, lazy chunk with Base UI's menu): lists on
  the left full screen, cards of the open list (virtualized, measured heights), reorder mode.
  `useProjectNotes` reads a project once (`['notes', root]`, never stale: only the app writes);
  `useNoteActions` changes the cache at once, then takes the backend's answer, a failure reads
  again. A card saves its text 500 ms after typing stops and on close (blur: `Esc`, `⌘↵`, a click
  outside); emptied, it goes.
- `infrastructure/platform/`: Tauri adapters implementing the ports.
- `shared/`: tokens, primitives, session state (`useSessionState`), `relativeTime`, clipboard, errors, shortcut labels and `shortcutKey`, keys (`isKeyTaken`,
  `isOwnKey`, `useWindowKeys`), toasts port, zoom transition, `preloadable`, project type, change
  areas, panel contract.
- `dev/`: browser fixtures (`?dev=app&scenario=…`), dev builds only.

### Dependency rules

`pnpm boundaries:check` enforces: `app` composes and owns no workflow state; `modules` never
import `app`, `infrastructure`, `dev` or another module; outside a module only its `index.ts`;
`infrastructure` implements module ports; `shared` imports only `shared`; `@tauri-apps/*` only in
`infrastructure/`.

### Panels

- `PanelDefinition` (`shared/panels/panel.ts`): id, title, icon, lazy component, optional level 0
  `summary`. `app/panels.ts` lists them in shortcut order and the level 1 tiles, preloading their
  chunks: `MAIN_TILE` (Changes, fills, keeps 560 px) and `SIDE_TILES` (Files above Notes) in
  `SideColumn`: as wide as the tree (`sidebarWidths.files`), at least 320 px with Notes in it
  (160 px without), giving way first; a splitter between its tiles (`split`, the upper's share).
  Files and Notes minimize to chips in the top bar (`zoom-panel-*` names: the view transition
  flies tile and chip into each other); ←/→ skip them, `2`/`3` still open them full screen.
- `PanelProps`: `project`; `header` (element filled through a portal; in a tile after the panel's
  icon, full screen shown only when filled); `edge` (for the side column's top tile: the gap
  before the column and the column, where Files portals the splitter that drags it; without
  Files the column has its own, fitting its least width); `target` (a request in the panel's terms, a new object
  each time); `place` (`tile`/`full`); `selected` (takes the keys: in a tile letters only, the
  arrows move among tiles); `show(panel, target)` (show something in another panel: selects its
  tile, or replaces the full-screen panel); `findInFiles(text)` (the palette's search in contents).
- A panel is remounted per project and per zoom; what must survive lives in `useSessionState`.
- Changes and Files share one selection per project (`model/selection.ts`): a changed file by key,
  or a tree path shown as a change while it is one. Changes selects it in its list; Files reveals
  it (opens the folders above). Targets (`fileTarget`) carry the path, the hunk to open on and a
  text to find from a line (opens the find bar: on that file only, until closed; `Esc` closes it
  first). The bar floats over the viewer's top right (`FindBar`, 300 px); while open the list
  leaves `FIND_BAR_SPACE` above its rows (virtualizer `scrollMargin`, scroll kept steady, browser
  scroll anchoring off) and a match under the bar counts as off screen (`rowWithin`). `⌘F` over
  a viewer (`Pane`, capture) opens its bar empty from the top, or comes back to it; in the bar's
  field `FindBar` takes it, as its icon, and calls `PanelProps.findInFiles`: the palette in
  contents with the bar's text. A commit's file has its own bar (`useCommitFileFind`); opening a
  commit closes the working tree's (`useFileFind().close`).

### Zoom and keyboard

- `AppShell` owns level, selected tile / full-screen panel and the pending target; every level
  change goes through `zoom` inside a view transition. `preloadable` parts render at once when
  their chunk is loaded, so a transition never captures an empty frame.
- `app/workspace-keys.ts`: `↵`/`Esc`, `1`-`9`, `←`/`→` (tiles), `[`/`]`, `⌘,`, `⌘K`, `⌘F` (also
  inside the palette, to switch mode; a viewer takes it first), `?` (`ShortcutsHelp`, lazy; list kept by hand: a new
  shortcut adds its line). Keys a field,
  dialog or menu takes are theirs. Panels listen with `useWindowKeys`; a panel taking `↵`/`Esc`
  listens while capturing and the workspace skips handled keys.
- `app/zoom-gestures.ts`: the wheel listener exists only while `⌘`/`Ctrl` is held.

### Toasts and problems

- Toasts (`useShowToast`) for failures nothing on screen waits for; Base UI toaster loaded with the
  first one, earlier ones queued. Dialogs show their own errors.
- A toast may carry an action (Undo: done, moved, deleted notes and lists): its own toast, 6 s.
- Problems (`app/problems.ts`) are derived from caches, never fetched (`repository_missing`, a
  refused global shortcut); popover loaded with the first problem.

### State

- No client store: projects, snapshots, summaries, diffs, tree folders and settings are TanStack
  Query caches, repository keys starting with the root. A snapshot writes its summary's cache.
- UI state: zoom level and selected tile (`AppShell`); the shared selection, the tree's open
  folders and row (session, per project); the viewed commit (Changes). Sidebar widths are one
  setting (`sidebarWidths`, by sidebar: `changes`, `files`, `notes`), the same in a tile and full screen,
  served to every module by `shared/ui/sidebar-width.ts` (`useSidebarWidth`, `SidebarSplitter`);
  a drag stores the width the layout allowed.
- Project list changes run in one mutation scope, in order; the last switch wins.
- Tiles per project (`ProjectList.layouts`, by root: minimized panels, split; `useProjectLayout`,
  `set_project_layout`): shown at once (in the same render, for the view transition), stored
  after; a removed project's layout goes with it.
- Theme: the backend sets the window theme, the page follows `prefers-color-scheme`; no script.
- The window is created hidden and shown once the project list is read (`show_window`, first
  call only; backend fallback after 3 s).

## Backend

- `bootstrap/`: plugins (single instance, dialog, store), state, commands; creates the hidden
  window in the stored theme, tray, restores projects, opens the CLI argument.
- `interfaces/tauri/`: commands, tray, window, and `state.rs` (project list, watcher of the project
  on screen, per-project coalesced snapshot/summary/tree reads, the cached tree). Blocking work on
  `spawn_blocking`.
- `modules/projects/`, `modules/settings/`, `modules/search/` (ranking, pure), `modules/notes/`
  (`Book` in memory, `NotesStore` over the `NotesStorage` port): no Tauri.
- `modules/repository/`: status and numstat parsers, snapshot, diffs, commits, tree and file
  content (`tree.rs`), path checks, ignored-paths filter, contracts. No Tauri; the outside world is
  the `RepositoryBackend` port (`git`, `read_file`, `read_entry`, `open_file`).
- `infrastructure/`: `git_cli.rs` (bounded git), `watcher.rs`, `settings_store.rs`,
  `notes_files.rs`, `logging.rs`.
- `shared/`: `AppError` (`{ code, message }`, stable codes), `coalesce.rs` (one run in flight,
  later callers share the next), `sync.rs`.

### Snapshot

- In parallel: `git status --porcelain=v2 -z --branch --untracked-files=all`, `git diff
  --numstat -z` (unstaged and `--cached`), `git diff HEAD --numstat` for the summary (staged +
  unstaged before the first commit).
- Untracked files are read to count lines (binary: NUL in the first 8 KiB): 4 MiB per file, 32 MiB
  and 2,000 files per snapshot.
- Summary: one entry per path (first three listed), lines of tracked files only. `load_summary`
  runs status + numstat vs HEAD and builds the same summary.
- At most 10,000 changed paths (`truncated`).

### Git limits

`limits.rs`; each call passes `max_stdout`: status 8 MiB, numstat 4 MiB, diff 2 MiB,
`check-ignore` its input size, ls-files 32 MiB. Pipes are read on threads; past the limit git is
killed and output is `truncated` (cut records dropped, diffs cut at a whole line). stderr keeps
64 KiB. 30 s timeout → `git_timed_out`. Git runs with `GIT_OPTIONAL_LOCKS=0` and
`-c core.fsmonitor=false`.

### Diffs and commits

- `git diff [--cached] --no-color --no-ext-diff -U3 -- <path>` (both paths for a staged rename;
  `--no-index /dev/null <path>` for untracked); `wholeFile` uses `-U` at git's maximum. The
  frontend parses from the first `@@`, so `diff.noprefix` and the like do not matter.
- Recent commits: `git log -z --first-parent -n 51 HEAD --ignore-missing --no-show-signature`.
  A commit's files: `git diff-tree -r -z --raw --numstat -M` against its first parent (`--root`
  for a root commit), at most 10,000; ids must be hashes (`invalid_commit`).

### Files

- List: `git ls-files -z --cached --others --exclude-standard` minus `--deleted` (in parallel),
  at most 200,000 files. `FileTree` sorts each folder as VS Code (folders first, case ignored,
  numbers by value) and resolves compact folders; `get_directory` serves one folder from memory,
  at most 10,000 entries plus a count.
- Only the tree of the project on screen is cached, read on first request. A batch drops it when
  the git dir changed or a non-ignored path appeared/disappeared (`may_have_changed`: `stat`
  against the tree); a marked batch while hidden and a project switch drop it too. A read racing a
  change is not kept.
- `ProjectsState::file_content`: only files of the tree. `read_entry` refuses a path through a
  linked folder, returns a link's target unfollowed, a submodule as a folder, a file's first
  2 MiB (cut at a whole line; binary by NUL).

### Search

`search` runs at every key: projects, panel titles (sent by the frontend) and, once something is
typed, the files of the project the request names (the one on screen; none at level 0): the cached
tree (read if missing) plus deleted files, each marked from the last snapshot (modified > added >
deleted). Words match independently, case ignored; matched letters return as UTF-16 offsets; at
most 500 files, the best picked without sorting the rest. From 20,000 paths scoring runs on up to
8 threads.

`search_contents` (`modules/search/contents.rs`, `grep-searcher`): the tree's files through
`open_file` (never through a link), up to 8 threads taking the next file, a fixed buffer each,
binary skipped at the first NUL, UTF-16 by BOM, the first 2 MiB per file (what the viewer
shows). Literal, smart case, at least 2 characters; stops at 2,000 lines; long lines cut to 300
characters around the first match. Files go through a `Channel` in batches every 50 ms. Each
search counts a run: a newer one (or `stop_content_search`) stops it. A complete search is kept
so a longer text (`narrows`) reads only the files it found, in the same tree; any watcher batch
drops it.

### Notes

- `<app data>/notes/<folder>/`, layout in `modules/notes/store.rs`; folder by root from each
  `project.json`, scanned once. The project read last stays in memory; a change writes only the
  files it touched (written beside, `sync_all`, renamed over; a leftover `.tmp` is removed when
  read), a failed write drops the memory copy. Nothing is written for a project until its first
  change. Ids: 16 hex digits, the only names let through to files.
- A note is at most 1 MiB (`note_too_long`); a broken file is skipped and logged, never removed.
- `notes_timings` (release, 1,000 notes): read 26 ms, a change 5 ms (mostly `sync_all`).

### Tray

Count of the project on screen from its snapshots and summaries (no git of its own): next to the
icon on macOS/Linux, tooltip everywhere. Menu: show, quit. macOS template glyph
(`icons/tray-template.png`). Closing the window hides it while the tray exists; on Linux without
appindicator the tray panic is caught and closing quits.

### Logs

`tracing` to the app's log dir (one file per session, previous kept, size cap). Development:
every git call, watcher batch and command duration, also on stderr. Release compiles out below
`info`: startup, project opened, failures, panics, frontend errors (max 50 per session). Hot-path
events are `debug`.
