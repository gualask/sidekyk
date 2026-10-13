# Architecture

Sidekyk is a Tauri 2 desktop app with a React/Vite frontend in `src/` and a Rust backend in
`src-tauri/`. It follows the same pragmatic modular-monolith layout as Fyler, scaled down to one
workflow.

## Data flow

```text
agent edits files ─▶ notify watcher of the project on screen (250 ms quiet period, filtered)
                        └─▶ skip paths git ignores (check-ignore, cached per directory)
                        └─▶ event "repository-changed" { version: 1, root }
                              └─▶ frontend invalidates ['repository', root, …] queries
                                    ├─▶ get_repository_snapshot(root)  (status + numstat ×3,
                                    │                                   its summary included)
                                    ├─▶ get_repository_summary(root)   (only when no snapshot
                                    │                                   brings it: level 0)
                                    └─▶ get_file_diff(root, …)         (one file, one area)
```

Projects are the repositories the user added (`get_projects`, `add_project`, `activate_project`,
`remove_project`). Commands name a repository by its root, and the backend serves only roots in the
project list. Only the project on screen is watched; the others cost nothing until shown.

The other projects show their summary (`get_repository_summary`: status and one numstat against
HEAD, new files not read) on the rail and on the level 0 cards. It is fetched once the first
paint is done, and again when the window comes to the front: an agent may have worked on any
project while the user was away. Nothing refreshes it while the window stays in front.

The snapshot also refetches when the window regains focus, as a safety net for changes the watcher
cannot see.

## Frontend

### Directory map

- `src/app/` — composition root: providers (`QueryClient`, runtime ports), the shell (top bar
  with the breadcrumb and the settings' gear, the zoom levels, panel tiles, `⌘,`), the list of
  panels (`panels.ts`). May depend on everything.
- `src/modules/projects/` — the project list: port and queries, the project rail, level 0's
  cards (`ProjectsOverview`, a chunk of its own with Base UI's menu, fetched once the window is
  idle after the first paint), the screen shown before the first project.
- `src/modules/settings/` — the settings: port and queries, and the dialog (a chunk of its own
  with Base UI's dialog and radio group, fetched once the window is idle after the first paint).
- `src/modules/changes/` — the review workflow, shown as the Changes panel (`panel.ts`).
  - `model/` — pure logic and wire types: unified-diff parser, agent snippet format, file grouping.
  - `application/` — `RepositoryPort` (context-provided) and the TanStack Query hooks.
  - `ui/` — the panel (`ChangesWorkspace`), file list, diff view and rows, the open file in the
    panel's header; the summary's views: the project's facts in the breadcrumb, the change count
    on the rail, the level 0 card's part (a chunk of its own, loaded with level 0). The file list
    and the diff are virtualized (`@tanstack/react-virtual`): they are flat lists of fixed-height rows
    (`fileListRows`, `diffRows`) and only the rows on screen are in the DOM.
- `src/infrastructure/platform/` — Tauri adapters (`invoke`, `listen`, the window) implementing
  the ports, including the title bar's (`TitleBarPort` in `shared/platform`: whether macOS's
  traffic lights overlay the top bar, which full screen turns off).
- `src/shared/` — stable primitives: theme tokens, button/chip primitives, the clipboard hook and
  copy icon, error messages, shortcut labels and modifiers (`⌘` or `Ctrl`, `platform/shortcut.ts`, from
  `platform/macos.ts`), the project type every layer shares (`projects/project-info.ts`), and
  the panel contract (`panels/panel.ts`).
- `src/dev/` — browser fixtures (`?dev=app&scenario=…`), loaded lazily and only in dev builds.

### Dependency rules

- `app` composes everything and owns no workflow state.
- `modules` do not import `app`, `infrastructure`, `dev` or another module.
- Outside a module, only its public API is imported: `@/modules/<name>`, its `index.ts`.
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
its component, so a panel that is not on screen runs none. The panel gets its header too
(`PanelProps.header`), an element it fills through a portal with what is open in it and its
actions: in a tile, after the panel's title; full screen, a header shown only while the panel
puts something in it. A panel may also give a `summary`: its part of a project's card at level 0,
a chunk of its own fetched with level 0.

### State

There is no client store. Git is the state: the project list, the snapshots, the summaries and
the diffs are TanStack Query caches, the last three keyed by repository root first, so a change on
disk refetches only that repository. A snapshot stores its summary in the summary's cache, and the
project in the Changes panel never fetches a summary of its own. UI state is the zoom level
(`AppShell`) and the selected file (`ChangesWorkspace`). Switching project updates the cached list
at once and the backend catches up; changes to the list run one at a time, in the user's order
(one TanStack mutation scope), so quick switches end on the last project clicked; the list a change
returns is shown only when no later change waits, so the screen never steps back through them.
When the selected file leaves the list, the selection falls back to the first file.

The settings are a TanStack Query cache as well, read when the dialog first opens. The theme is
not React state: the backend gives the window the theme of the settings (when it creates it, and
on `set_settings`), the page's `prefers-color-scheme` follows the window's theme, and the dark
tokens apply under that media query (`theme.css`), with no script. The first paint has the right
colors without waiting for the backend. In the browser fixtures the page follows the system's
theme, or the devtools' emulation, and the setting is only kept.

## Backend

- `bootstrap/` — plugins (single instance, dialog, store), managed state, command list. Creates
  the window (`create: false` in `tauri.conf.json`) in the theme of the settings, restores the
  projects, and adds and shows the repository of the first CLI argument, if any.
- `interfaces/tauri/` — commands (`projects.rs`, `repository.rs`, `settings.rs`, and
  `log_frontend_error` in `diagnostics.rs`) and `state.rs`, the one place that changes the project list and watches the
  project on screen. Blocking work runs on `spawn_blocking` (`blocking.rs`). At most one snapshot
  and one summary per project run at a time: requests that arrive during one share the next
  (`shared/coalesce.rs`), so a burst of refreshes costs two snapshots, not one per request.
- `modules/projects/` — the project list: adding, activating, removing, and a stored list made
  consistent. No Tauri.
- `modules/settings/` — the settings and their defaults (`Settings`, `Theme`). No Tauri.
- `modules/repository/` — porcelain v2 and numstat parsers, snapshot assembly, diff loading, path
  validation, the ignored-paths filter for watcher events, wire contracts. A repository moved or
  deleted after it was added fails its snapshot and diffs with `repository_missing`, before git
  runs. No Tauri; the outside world is the `RepositoryBackend` port.
- `infrastructure/` — `git_cli.rs` (the `git` CLI, found on PATH or in the usual install dirs),
  `watcher.rs` (`notify-debouncer-mini`, sorting events into git-dir and working-tree changes),
  `settings_store.rs` (the settings and the projects, through `tauri-plugin-store`; an older
  version's last repository becomes the first project), `logging.rs` (see Logs).
- `shared/` — `error.rs`: `AppError`, serialized as `{ code, message }` with stable codes;
  `coalesce.rs`: one computation in flight at a time, its result shared by the callers waiting;
  `sync.rs`: locking a mutex past a panic.

### Snapshot

1. `git status --porcelain=v2 -z --branch --untracked-files=all` — branch, ahead/behind, entries.
2. `git diff --numstat -z` and `git diff --cached --numstat -z` — per-file counts per area.
3. Untracked files are counted by reading them (binary when a NUL appears in the first 8 KiB),
   within limits per snapshot: 4 MiB per file, 32 MiB and 2,000 files in all. A file past them is
   not counted, which the frontend shows apart from binary (`binary` is a field of its own).
4. The summary compares against HEAD (`git diff HEAD --numstat`), so a line staged and edited
   again counts once; before the first commit the staged and unstaged counts are added instead.
   It has one entry per path (the first three, and how many there are), and its lines are those
   of tracked files: new files count as files, their lines unread.

The four git commands are independent and run in parallel, so a snapshot costs about as much as
the slowest of them. A summary alone (`load_summary`) runs only steps 1 and 4, in parallel, and
builds the same summary from them, so a project's numbers do not depend on whether it is the one
in the Changes panel. `backend_timings` (an ignored test, see `AGENTS.md`) measures the snapshot,
the summary and a diff on any repository.

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
