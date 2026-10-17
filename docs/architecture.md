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
- `modules/search/`: palette (lazy chunk); ranking is the backend's; the app decides what an item
  opens (`PaletteActions`).
- `modules/repository/`: the repository on screen as two panels (`panel.ts`): Changes (review
  and the viewer of any file) and Files (the tree).
  - `model/`: wire types, diff parser, whole-file hunks, copy format, file grouping, tree rows and
    keys (`file-tree.ts`), the shared selection (`selection.ts`), panel targets (`targets.ts`).
  - `application/`: `RepositoryPort`, TanStack Query hooks, commit view, session state
    (`useSessionState`, a live store by key; `useSelectedFile` for the shared selection),
    `useShownTarget`, `RepositorySettings` (what the app passes from the settings).
  - `ui/`: `ChangesWorkspace`, `FilesWorkspace`, `FileTree` (+ `tree-layout.ts`), the viewer
    `Pane` (rows, copy, current hunk) under `ChangeDiffView`, `CommitDiffView`, `TextFileView`,
    one `FileHeader`, recent commits, summary views (breadcrumb facts, rail count, level 0 card).
    Lists, tree and diff are virtualized flat lists of fixed-height rows.
- `infrastructure/platform/`: Tauri adapters implementing the ports.
- `shared/`: tokens, primitives, clipboard, errors, shortcut labels, keys (`isKeyTaken`,
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
  `summary`. `app/panels.ts` lists them in shortcut order and the level 1 tiles (`TILES`: Changes
  grows, Files is as wide as its tree), preloading the tiles' chunks.
- `PanelProps`: `project`; `header` (element filled through a portal; in a tile after the panel's
  icon, full screen shown only when filled); `target` (a request in the panel's terms, a new object
  each time); `place` (`tile`/`full`); `selected` (takes the keys: in a tile letters only, the
  arrows move among tiles); `show(panel, target)` (show something in another panel: selects its
  tile, or replaces the full-screen panel).
- A panel is remounted per project and per zoom; what must survive lives in `useSessionState`.
- Changes and Files share one selection per project (`model/selection.ts`): a changed file by key,
  or a tree path shown as a change while it is one. Changes selects it in its list; Files reveals
  it (opens the folders above). Targets (`changesTarget`, `fileTarget`) carry the hunk to open on.

### Zoom and keyboard

- `AppShell` owns level, selected tile / full-screen panel and the pending target; every level
  change goes through `zoom` inside a view transition. `preloadable` parts render at once when
  their chunk is loaded, so a transition never captures an empty frame.
- `app/workspace-keys.ts`: `↵`/`Esc`, `1`-`9`, `←`/`→` (tiles), `[`/`]`, `⌘,`, `⌘K`. Keys a field,
  dialog or menu takes are theirs. Panels listen with `useWindowKeys`; a panel taking `↵`/`Esc`
  listens while capturing and the workspace skips handled keys.
- `app/zoom-gestures.ts`: the wheel listener exists only while `⌘`/`Ctrl` is held.

### Toasts and problems

- Toasts (`useShowToast`) for failures nothing on screen waits for; Base UI toaster loaded with the
  first one, earlier ones queued. Dialogs show their own errors.
- Problems (`app/problems.ts`) are derived from caches, never fetched (`repository_missing`, a
  refused global shortcut); popover loaded with the first problem.

### State

- No client store: projects, snapshots, summaries, diffs, tree folders and settings are TanStack
  Query caches, repository keys starting with the root. A snapshot writes its summary's cache.
- UI state: zoom level and selected tile (`AppShell`); the shared selection, the tree's open
  folders and row (session, per project); the viewed commit (Changes). The tree width is a
  setting.
- Project list changes run in one mutation scope, in order; the last switch wins.
- Theme: the backend sets the window theme, the page follows `prefers-color-scheme`; no script.
- The window is created hidden and shown once the project list is read (`show_window`, first
  call only; backend fallback after 3 s).

## Backend

- `bootstrap/`: plugins (single instance, dialog, store), state, commands; creates the hidden
  window in the stored theme, tray, restores projects, opens the CLI argument.
- `interfaces/tauri/`: commands, tray, window, and `state.rs` (project list, watcher of the project
  on screen, per-project coalesced snapshot/summary/tree reads, the cached tree). Blocking work on
  `spawn_blocking`.
- `modules/projects/`, `modules/settings/`, `modules/search/` (ranking, pure): no Tauri.
- `modules/repository/`: status and numstat parsers, snapshot, diffs, commits, tree and file
  content (`tree.rs`), path checks, ignored-paths filter, contracts. No Tauri; the outside world is
  the `RepositoryBackend` port (`git`, `read_file`, `read_entry`).
- `infrastructure/`: `git_cli.rs` (bounded git), `watcher.rs`, `settings_store.rs`, `logging.rs`.
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

`search` runs at every key: projects, panel titles (sent by the frontend) and the changed paths of
the project on screen from its last snapshot; no git. Words match independently, case ignored;
matched letters return as UTF-16 offsets; at most 500 files.

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
