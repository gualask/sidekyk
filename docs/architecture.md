# Architecture

Tauri 2 app: React/Vite frontend in `src/`, Rust backend in `src-tauri/`, a modular monolith as in
Fyler. Each area in `features/`.

## Data flow

```text
agent edits files ─▶ watcher of the project on screen (notify, 250 ms quiet period)
                       └─▶ reads dropped (inotify reports them: git's own reads would loop)
                       └─▶ hidden window: batch dropped, project only marked
                       └─▶ paths git ignores skipped (check-ignore, cached per directory);
                           without git, those the walk's rules hide
                       └─▶ `.git` come or gone at the root: watched again as the other kind
                       └─▶ "repository-changed" { version: 4, projectId, gitDir, paths,
                                                  kindChanged }
                             └─▶ frontend invalidates ['repository', projectId, …]
                                 (kindChanged: reset; commits and staged diffs only when
                                 gitDir; the open file, diff and colors only when paths touch
                                 them; paths null over 100 or when unknown)
                                   ├─▶ get_repository_snapshot   status + numstats, with summary
                                   ├─▶ get_repository_summary    level 0 only
                                   ├─▶ get_file_diff             one file, one area
                                   ├─▶ get_recent_commits        only while unfolded
                                   ├─▶ get_directory             each open folder, from memory
                                   ├─▶ get_file_content          the unchanged file shown
                                   ├─▶ get_markdown_preview      a Markdown file as it reads
                                   ├─▶ get_file_stamp            an image's size and mtime
                                   └─▶ get_syntax_colors         blocks of lines on screen
```

- A commit's files and diffs never change: cached under `['commit', …]`, read once.
- Commands name a project by its id and serve only projects in the list; the core reads a folder
  by its root on the machine that holds it (`features/wsl.md`).

## Frontend

- `app/`: composition root: providers, shell (top bar, levels, tiles), keys and zoom gestures,
  panels (`panels.ts`), problems.
- `modules/`: `projects` (list, level 0 cards, dialogs), `repository` (Changes and Files, the
  folder's kind; `model/` wire types and parsers, `application/` port and queries, `ui/`),
  `notes`, `search` (the palette; ranking and reading are the backend's), `settings`. Each panel
  module one lazy chunk.
- `infrastructure/platform/`: Tauri adapters implementing the ports. `shared/`: tokens, primitives,
  session state (`useSessionState`), keys, errors, i18n, the panel contract, the project type. `dev/`:
  browser fixtures.
- Rules (`pnpm boundaries:check`): `app` composes and owns no workflow state; `modules` never import
  `app`, `infrastructure`, `dev` or another module; outside a module only its `index.ts`;
  `shared` imports only `shared`; `@tauri-apps/*` only in `infrastructure/`.
- Panels: `PanelDefinition` (`shared/panels/panel.ts`): id, title, icon, lazy component, needs,
  optional `summary` and `tileMinWidth`. `PanelProps`: `project`, `header` (a portal), `tileFit`,
  `target` (a request in the panel's terms), `place` (`tile`/`full`), `selected` (takes the keys),
  `show(panel, target)`, `findInFiles(text)`. A panel remounts per project and zoom; what must
  survive lives in `useSessionState`.
- State: no client store; projects, snapshots, summaries, diffs, tree folders, notes and settings
  are TanStack Query caches, a project's keys starting with its id. Settings changed from the app
  go through `useChangeSettings`, each change from the settings as they are then. UI state: level
  and tile in `AppShell`; selection, open folders and row per project (session). Theme: the backend
  sets the window's, the page follows `prefers-color-scheme`.

## Backend

A Cargo workspace (`src-tauri/Cargo.toml`), crates versioned together; commands cover every crate
(`default-members`) except `cargo fmt`, which needs `--all`.

- `src-tauri/` (`sidekyk`): `bootstrap/` (plugins, state, commands, the hidden window, tray, the
  CLI argument), `interfaces/tauri/` (commands, tray, window, `state.rs`: the project list and the
  `Repositories` it is read through; blocking work on `spawn_blocking`), and the app's own
  infrastructure (`settings_store.rs`, `notes_files.rs`, `logging.rs`, `system_shortcuts.rs`).
- `src-tauri/crates/core/` (`sidekyk-core`): no Tauri, which the compiler keeps out; the app runs
  all of it, the helper what reads a folder. Its items are `pub` for the app, so one the app stops
  using no longer warns.
  - `modules/repository/`: parsers, snapshot, diffs, commits, tree, file content, path checks,
    the ignored-paths filter, which changes matter (`watched.rs`) and which folders to watch
    (`folders.rs`). No disk of its own: the `RepositoryBackend` port (git, reads, `walk`,
    `folder_rules`, `real_path`) and the `RepositoryWatcher` port.
  - `modules/repositories/`: the `Repositories` port, one method per read, and `LocalRepositories`
    (coalesced reads, the cached tree, the last content search, `ColorCache`, the watched folder,
    `watch.rs`).
  - `modules/folder/`: a folder without git: kind, `resolve_folder`, tree, `FolderChanges`,
    `always_hidden`.
  - `modules/projects`, `settings`, `search` (pure ranking), `notes` (`NotesStore` over
    `NotesStorage`), `syntax`, `preview` (Markdown to the preview's tree, pure).
  - `infrastructure/`: `git_cli.rs`, `folder_walk.rs` (`ignore`), `process.rs` (a child within an
    output size and a time), `watcher.rs` (notify), `agent/`, `linux_helper.rs`, `wsl.rs`,
    `machines.rs` (`features/wsl.md`).
  - `shared/`: `AppError` (`{ code, message }`; a new code needs its key in `app-error.ts` and both
    catalogs), `coalesce.rs` (one run in flight, later callers share the next), `threads.rs` (8 at
    most).
- `src-tauri/crates/agent/` (`sidekyk-agent`): the helper's binary, `version` and `serve`.

### Git

- The `git` CLI, no libgit2: every answer is what the user's git prints. Found on the PATH, else in
  `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin` or `C:\Program Files\Git\cmd`; on Windows
  without a console window (`CREATE_NO_WINDOW`). No git runs for a folder without git.
- `GIT_OPTIONAL_LOCKS=0`, `-c core.fsmonitor=false` (a repository's config cannot make Sidekyk run
  a command), `GIT_TERMINAL_PROMPT=0`, `LC_ALL=C`.
- Paths after `--` are literal (2026-10-31): `--literal-pathspecs` on diff, diff-tree and the
  snapshot's numstats, else `[id].tsx` also matched `i.tsx` and a file's diff held both. Not
  `GIT_LITERAL_PATHSPECS` for every command: `check-ignore` refuses it.
- Bounded (`limits.rs`): status 8 MiB, numstat 4 MiB, diff 2 MiB, ls-files 32 MiB, `check-ignore`
  its input; past the limit git is killed and the output `truncated` (cut records dropped, diffs cut
  at a line). stderr 64 KiB. 30 s → `git_timed_out`.

### Watching

- macOS and Windows: one recursive watch of the root (and of the git dir when outside it).
- Linux (2026-10-21; the app and the helper): inotify watches one folder at a time, and notify's
  recursive watch took every folder, `node_modules/` included, and gave up the project at the first
  failure (`max_user_watches`); fanotify needs `CAP_SYS_ADMIN`. So, as VS Code
  (`@parcel/watcher`) and Zed, `folders.rs` watches each folder git does not ignore
  (`check-ignore` once per level), each before reading it, not inside a submodule nor through a
  link; in the git dir itself, `refs/`, `info/`. A folder a batch created is watched before the
  change is told; one created while hidden when the window shows. A `.gitignore` changed: every
  folder looked at again. At the system's limit the watches stay, one `warn`, no more asked
  (8,192 before Linux 5.11, then 1% of RAM within 8,192-1,048,576).
- A folder without git (2026-10-24): no git dir; `FolderChanges` drops what the walk's rules hide
  (`folder_rules`: `ignore`'s `IncrementalIgnore` from the walk's own builder, so both agree,
  global excludes included); on Linux `folders.rs` keeps those folders out too. An ignore file
  changed: rules read again.
- Kind: a batch with `<root>/.git` that no longer matches the watch restarts it as the other kind
  on its own thread and tells `kind_changed`, also while hidden (rare, no git).
- A repository inside the root (2026-10-29: a submodule, a clone, Claude Code's
  `.claude/worktrees/` unless ignored): `git status` shows its folder, never its files, yet
  `check-ignore` calls them visible. `ignored.rs` drops paths under a folder holding a `.git` (the
  disk asked once per folder of a batch, +1 ms on 5,000 paths), as Linux by not watching them.
- Events the system dropped (2026-10-29: `IN_Q_OVERFLOW`, `MustScanSubDirs`): notify's pathless
  event, which the debouncer drops, goes as `Changed::Unknown`: git dir and any path may have
  changed, folders rescanned on Linux, the project marked if hidden. Windows: notify 8.2.1 loses
  both forms (a 0-byte completion; `ERROR_NOTIFY_ENUM_DIR`, which also ends the watch), 9.0.0-rc.5
  rescans (notify-rs#964).

### Logs

`tracing` to the app's log dir (one file per session, the previous kept, a size cap). Dev builds:
every git call, batch and command duration, also on stderr. The level applies to the app, the core
and the helper's lines (target `helper`). Release compiles out below `info` (+144 KiB): startup,
project opened, failures, panics, frontend errors (50 per session). Hot-path events are `debug`.
