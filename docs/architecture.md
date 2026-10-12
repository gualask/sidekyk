# Architecture

Sidekyk is a Tauri 2 desktop app with a React/Vite frontend in `src/` and a Rust backend in
`src-tauri/`. It follows the same pragmatic modular-monolith layout as Fyler, scaled down to one
workflow.

## Data flow

```text
agent edits files ─▶ notify watcher of the project on screen (250 ms quiet period, filtered)
                        └─▶ skip paths git ignores (check-ignore, cached per directory)
                        └─▶ event "repository-changed" { version: 1, root }
                              └─▶ frontend invalidates ['repository', …] queries
                                    ├─▶ get_repository_snapshot(root)  (status + numstat ×3)
                                    └─▶ get_file_diff(root, …)         (one file, one area)
```

Projects are the repositories the user added (`get_projects`, `add_project`, `activate_project`,
`remove_project`). Commands name a repository by its root, and the backend serves only roots in the
project list. Only the project on screen is watched; the others cost nothing until shown.

The snapshot also refetches when the window regains focus, as a safety net for changes the watcher
cannot see.

## Frontend

### Directory map

- `src/app/` — composition root: providers (`QueryClient`, runtime ports), the shell (top bar
  with the breadcrumb, the zoom levels, panel tiles), the list of panels (`panels.ts`), system
  color scheme. May depend on everything.
- `src/modules/projects/` — the project list: port and queries, the project rail, level 0's
  cards (`ProjectsOverview`, a chunk of its own with Base UI's menu, fetched once the window is
  idle after the first paint), the screen shown before the first project.
- `src/modules/changes/` — the review workflow, shown as the Changes panel (`panel.ts`).
  - `model/` — pure logic and wire types: unified-diff parser, agent snippet format, file grouping.
  - `application/` — `RepositoryPort` (context-provided) and the TanStack Query hooks.
  - `ui/` — summary bar, file list, diff view, diff rows, empty states. The file list and the
    diff are virtualized (`@tanstack/react-virtual`): they are flat lists of fixed-height rows
    (`fileListRows`, `diffRows`) and only the rows on screen are in the DOM.
- `src/infrastructure/platform/` — Tauri adapters (`invoke`, `listen`, the window) implementing
  the ports, including the title bar's (`TitleBarPort` in `shared/platform`: whether macOS's
  traffic lights overlay the top bar, which full screen turns off).
- `src/shared/` — stable primitives: theme tokens, button/chip primitives, clipboard hook, error
  messages, and the panel contract (`panels/panel.ts`).
- `src/dev/` — browser fixtures (`?dev=app&scenario=…`), loaded lazily and only in dev builds.

### Dependency rules

- `app` composes everything and owns no workflow state.
- `modules` do not import `app`, `infrastructure`, `dev` or another module.
- `infrastructure` implements ports owned by modules; it does not import `app`.
- `shared` imports only `shared`.
- Direct `@tauri-apps/*` imports live only under `src/infrastructure/`.

`pnpm boundaries:check` enforces these rules.

### Panels

A panel is a module's `PanelDefinition` (`src/shared/panels/panel.ts`): id, title, icon and a
component loaded with `import()`, one chunk per module. The component receives the project it
shows (`PanelProps`), so panels never ask which project is active. `src/app/panels.ts` lists them
in shortcut order and starts loading the startup panel's chunk as soon as the app's code runs, so
it does not wait for the first render. The shell renders a panel inside `Suspense`; a panel's queries live in
its component, so a panel that is not on screen runs none.

### State

There is no client store. Git is the state: the project list, the snapshot and the diffs are
TanStack Query caches, the last two keyed by repository root. UI state is the zoom level
(`AppShell`) and the selected file (`ChangesWorkspace`). Switching project updates the cached list
at once and the backend catches up; changes to the list run one at a time, in the user's order
(one TanStack mutation scope), so quick switches end on the last project clicked.
When the selected file leaves the list, the selection falls back to the first file.

## Backend

- `bootstrap/` — plugins (single instance, dialog, store), managed state, command list. Restores
  the projects, and adds and shows the repository of the first CLI argument, if any.
- `interfaces/tauri/` — commands (`projects.rs`, `repository.rs`, and `log_frontend_error` in
  `diagnostics.rs`) and `state.rs`, the one place that changes the project list and watches the
  project on screen. Blocking work runs on `spawn_blocking` (`blocking.rs`). At most one snapshot
  per project runs at a time: requests that arrive during it share the next one
  (`shared/coalesce.rs`), so a burst of refreshes costs two snapshots, not one per request.
- `modules/projects/` — the project list: adding, activating, removing, and a stored list made
  consistent. No Tauri.
- `modules/repository/` — porcelain v2 and numstat parsers, snapshot assembly, diff loading, path
  validation, the ignored-paths filter for watcher events, wire contracts. A repository moved or
  deleted after it was added fails its snapshot and diffs with `repository_missing`, before git
  runs. No Tauri; the outside world is the `RepositoryBackend` port.
- `infrastructure/` — `git_cli.rs` (the `git` CLI, found on PATH or in the usual install dirs),
  `watcher.rs` (`notify-debouncer-mini`, sorting events into git-dir and working-tree changes),
  `settings_store.rs` (the projects, through `tauri-plugin-store`; an older version's last
  repository becomes the first project), `logging.rs` (see Logs).
- `shared/` — `error.rs`: `AppError`, serialized as `{ code, message }` with stable codes;
  `coalesce.rs`: one computation in flight at a time, its result shared by the callers waiting;
  `sync.rs`: locking a mutex past a panic.

### Snapshot

1. `git status --porcelain=v2 -z --branch --untracked-files=all` — branch, ahead/behind, entries.
2. `git diff --numstat -z` and `git diff --cached --numstat -z` — per-file counts per area.
3. Untracked files are counted by reading them (binary when a NUL appears in the first 8 KiB),
   within limits per snapshot: 4 MiB per file, 32 MiB and 2,000 files in all. A file past them is
   not counted, which the frontend shows apart from binary (`binary` is a field of its own).
4. Totals compare against HEAD (`git diff HEAD --numstat`), so a line staged and edited again
   counts once. Before the first commit the staged and unstaged counts are added instead.

The four git commands are independent and run in parallel, so a snapshot costs about as much as
the slowest of them. `backend_timings` (an ignored test, see `AGENTS.md`) measures the snapshot
and a diff on any repository.

### Diffs

`git diff [--cached] --no-color --no-ext-diff -U3 -- <path>`; a staged rename passes both paths;
an untracked file uses `--no-index /dev/null <path>`. Output larger than 2 MiB is cut at a line
boundary and flagged `truncated`. The frontend parses the text, so user settings such as
`diff.noprefix` do not matter: parsing starts at the first `@@`.

### Logs

`tracing` events, written by `tracing-subscriber` as text lines with `key=value` fields to the
app's log directory (one file per session, the previous one kept, a size cap per session).

- **Development** (`debug` and below): every git command with its arguments, exit code, duration
  and output size; every watcher batch with its path count and whether it refreshed the app;
  every command's duration; snapshots that coalesced into one in flight. Also on stderr.
- **Release**: `release_max_level_info` compiles `debug` and `trace` events out, so the hot
  paths pay nothing. What is left is rare by design: startup, the repository opened, refused
  and failed commands, watcher errors, panics, and uncaught frontend errors (`log_frontend_error`,
  at most 50 per session, through the `reportError` runtime port).
- A new event on a hot path is `debug`. `info` and above are for what happens a few times per
  session or signals a problem.
