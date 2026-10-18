# Architecture

Tauri 2 app: React/Vite frontend in `src/`, Rust backend in `src-tauri/`, a modular monolith as
in Fyler. Each area in `features/`.

## Data flow

```text
agent edits files ─▶ watcher of the project on screen (notify, 250 ms quiet period)
                       └─▶ reads dropped (inotify reports them: git's own reads would loop)
                       └─▶ hidden window: batch dropped, project only marked
                       └─▶ paths git ignores skipped (check-ignore, cached per directory)
                       └─▶ "repository-changed" { version: 1, projectId, gitDir }
                             └─▶ frontend invalidates ['repository', projectId, …]
                                 (recent commits only when gitDir: index, HEAD, refs)
                                   ├─▶ get_repository_snapshot   status + numstat ×3, with summary
                                   ├─▶ get_repository_summary    level 0 only (no snapshot there)
                                   ├─▶ get_file_diff             one file, one area
                                   ├─▶ get_recent_commits        only while unfolded
                                   ├─▶ get_directory             each open folder, from memory
                                   ├─▶ get_file_content          the unchanged file shown
                                   └─▶ get_syntax_colors         blocks of lines on screen
```

- A commit's files and diffs (`get_commit_files`, `get_commit_file_diff`) never change: cached
  under `['commit', …]`, read once.
- Commands name a project by its id (`features/projects.md`); the backend serves only projects in
  the list. The core reads a repository by its root on the machine that holds it; the app turns
  what it reports back into the project's id.
- Projects not on screen: not watched; their summary is read after the first paint, when the
  window shows again and when level 0 shows, only if older than 30 s (`features/projects.md`).
- Window hidden, minimized or covered: no git (`features/background.md`).

## Frontend

### Directory map

- `app/`: composition root: providers, shell (top bar, zoom levels, tiles), keyboard and zoom
  gestures, panel list (`panels.ts`).
- `modules/projects/`: project list, rail, level 0 cards (lazy chunk with Base UI's menu), empty
  screen.
- `modules/settings/`: settings queries and dialog (lazy chunk).
- `modules/search/`: palette (lazy chunk), by name (`⌘K`) or in contents (`⌘F`); ranking and
  reading are the backend's; the app decides what an item opens (`PaletteActions`).
- `modules/repository/`: the repository on screen as two panels (`panel.ts`): Changes (review
  and the viewer of any file) and Files (the tree).
  - `model/`: wire types, diff parser, whole-file hunks, copy format, file grouping, tree rows and
    keys (`file-tree.ts`), the shared selection (`selection.ts`), panel targets (`targets.ts`),
    matches of the find bar (`find.ts`), syntax blocks (`syntax.ts`).
  - `application/`: `RepositoryPort`, TanStack Query hooks, commit view, session state
    (`useSelectedFile` for the shared selection), `useShownTarget`, `useFileFind` (the find bar's
    text, per project), `RepositorySettings` (what the app passes from the settings).
  - `ui/`: `ChangesWorkspace`, `FilesWorkspace`, `FileTree` (+ `tree-layout.ts`), the viewer
    `Pane` (rows, copy, current hunk, `FindBar`) under `ChangeDiffView`, `CommitDiffView`,
    `TextFileView`, one `FileHeader`, recent commits, summary views (breadcrumb facts, rail count,
    level 0 card). Lists, tree and diff are virtualized flat lists of fixed-height rows.
- `modules/notes/`: the Notes panel (`NotesWorkspace`, lazy chunk with Base UI's menu;
  `features/notes.md`).
- `infrastructure/platform/`: Tauri adapters implementing the ports.
- `shared/`: tokens, primitives (`InlineField`, `trackDrag`), session state (`useSessionState`),
  `relativeTime`, clipboard, errors, shortcut labels and `shortcutKey`, keys (`isKeyTaken`,
  `isOwnKey`, `useWindowKeys`), toasts port, zoom transition, `preloadable`, project type, change
  areas, panel contract, sidebar widths (`ui/sidebar-width.ts`).
- `dev/`: browser fixtures (`?dev=app&scenario=…`), dev builds only.

### Dependency rules

`pnpm boundaries:check` enforces: `app` composes and owns no workflow state; `modules` never
import `app`, `infrastructure`, `dev` or another module; outside a module only its `index.ts`;
`infrastructure` implements module ports; `shared` imports only `shared`; `@tauri-apps/*` only in
`infrastructure/`.

### Panels

- `PanelDefinition` (`shared/panels/panel.ts`): id, title, icon, lazy component, optional level 0
  `summary`, optional `tileMinWidth`. `app/panels.ts` lists them in shortcut order and the level 1
  tiles, preloading their chunks; one lazy chunk per module, no queries off screen. Tile layout in
  `features/workspace.md`.
- `PanelProps`: `project`; `header` (element filled through a portal; in a tile after the panel's
  icon, full screen shown only when filled); `tileFit` (in a tile the app sizes: the panel
  registers how wide it needs it, for the splitter's double click); `target` (a request in the
  panel's terms, a new object each time); `place` (`tile`/`full`); `selected` (takes the keys: in
  a tile letters only, the arrows move among tiles); `show(panel, target)` (show something in
  another panel: selects its tile, or replaces the full-screen panel); `findInFiles(text)` (the
  palette's search in contents).
- A panel is remounted per project and per zoom; what must survive lives in `useSessionState`.

### State

- No client store: projects, snapshots, summaries, diffs, tree folders, notes and settings are
  TanStack Query caches, repository keys starting with the project's id. A snapshot writes its
  summary's cache.
- Settings changed from the app's bridges (sidebar widths, note lines) go through
  `useChangeSettings`: each change starts from the settings as they are then, so two in a row
  both stay.
- UI state: zoom level and selected tile (`AppShell`); the shared selection, the tree's open
  folders and row (session, per project); the viewed commit (Changes).
- Theme: the backend sets the window theme, the page follows `prefers-color-scheme`; no script.

## Backend

A Cargo workspace rooted at `src-tauri/Cargo.toml`, crates versioned together; commands run there
cover every crate (`default-members`), except `cargo fmt`, which needs `--all`.

- `src-tauri/` (the app, `sidekyk`): Tauri, `bootstrap/`, `interfaces/`, and the infrastructure
  only the app needs (`settings_store.rs`, `notes_files.rs`, `logging.rs`, `system_shortcuts.rs`).
- `src-tauri/crates/core/` (`sidekyk-core`): `modules/`, `shared/`, and the infrastructure of the
  machine holding the repository (`git_cli.rs`, `watcher.rs`, the helper's protocol). No Tauri:
  the compiler keeps it out. The app runs all of it; the helper runs what reads a repository
  (`plans/remote-projects.md`). Its items are `pub` for the app, so an item the app stops using no
  longer warns as dead code.
- `src-tauri/crates/agent/` (`sidekyk-agent`): the helper's binary, `version` and `serve`; its
  tests drive it as the app does.

In the app:

- `bootstrap/`: plugins (single instance, dialog, store), state, commands; creates the hidden
  window in the stored theme, tray, restores projects, opens the CLI argument.
- `interfaces/tauri/`: commands, tray, window, and `state.rs` (the project list, the order of
  watch calls, and the `Repositories` the projects are read through; the commands check a project
  is in the list first, and find what reads it from its location). Blocking work on
  `spawn_blocking`.

In the core:

- `modules/repositories/`: the `Repositories` port (`port.rs`), one method per read, and
  `LocalRepositories`, which reads this machine's: per-repository coalesced snapshot/summary/tree
  reads, the cached tree, the changed files the palette ranks, the last search in contents,
  syntax colors (`ColorCache`), and the watched repository (`watch.rs`: a batch through
  `classify`, the ignored filter and the tree check; only a mark while the window is hidden).
- `infrastructure/agent/`: the helper's protocol (`protocol.rs`), its side (`server.rs`, over
  `LocalRepositories`) and the app's (`client.rs`, `AgentRepositories`: the same port through a
  child process). The app reads through `LocalRepositories`, or in dev builds with
  `SIDEKYK_AGENT=local` through the helper (`plans/remote-projects.md`).

- `modules/projects/`, `modules/settings/`, `modules/search/` (ranking, pure), `modules/notes/`
  (`Book` in memory, `NotesStore` over the `NotesStorage` port), `modules/syntax/` (colors, over
  `modules/repository`): no Tauri.
- `modules/repository/`: status and numstat parsers, snapshot, diffs, commits, tree and file
  content (`tree.rs`), a version's whole text (`version.rs`), path checks, ignored-paths filter,
  which watched changes matter (`watched.rs`), contracts. No Tauri, no disk of its own: it
  declares the `RepositoryBackend` port (`git`, `read_file`, `read_entry`, `open_file`, `is_dir`,
  `has_entry`) and the `RepositoryWatcher` port (changed paths after a quiet period), so it can
  run on another machine (`plans/remote-projects.md`).
- `infrastructure/`: `git_cli.rs` (bounded git), `watcher.rs` (notify; drops reads, which inotify
  reports: each git command's reads would refresh again, without end; found by CI 2026-10-18).
- `shared/`: `AppError` (`{ code, message }`, stable codes; a new code needs its message in
  `app-error.ts`), `coalesce.rs` (one run in flight, later callers share the next), `sync.rs`.

### Git

- The `git` CLI, no libgit2: every answer is what the user's own git would print. Found on the
  PATH, else in `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin` or `C:\Program Files\Git\cmd`;
  on Windows without a console window (`CREATE_NO_WINDOW`).
- Runs with `GIT_OPTIONAL_LOCKS=0` (never takes `index.lock`), `-c core.fsmonitor=false` (a
  repository's config cannot make Sidekyk run a command), `GIT_TERMINAL_PROMPT=0`, `LC_ALL=C`.
- Bounded (`limits.rs`): each call passes `max_stdout`: status 8 MiB, numstat 4 MiB, diff 2 MiB,
  `check-ignore` its input size, ls-files 32 MiB. Pipes are read on threads; past the limit git is
  killed and output is `truncated` (cut records dropped, diffs cut at a whole line). stderr keeps
  64 KiB. 30 s timeout → `git_timed_out`.

### Logs

`tracing` to the app's log dir (one file per session, previous kept, size cap). Development:
every git call, watcher batch and command duration, also on stderr. The level set applies to the
app, its core and the helper's lines (target `helper`, at the level the helper wrote them). Release compiles out below
`info` (+144 KiB on the binary): startup, project opened, failures, panics, frontend errors (max
50 per session). Hot-path events are `debug`.
