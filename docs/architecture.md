# Architecture

Tauri 2 app: React/Vite frontend in `src/`, Rust backend in `src-tauri/`, a modular monolith as in
Fyler. Each area in `features/`.

## Data flow

```text
agent edits files ─▶ watcher of the project on screen (notify, 250 ms quiet period,
                       at most one report per second while changes go on)
                       └─▶ reads dropped (inotify reports them: git's own reads would loop)
                       └─▶ hidden window: batch dropped, project only marked
                       └─▶ paths git ignores skipped (check-ignore, cached per directory);
                           without git, those the walk's rules hide
                       └─▶ `.git` come or gone at the root: watched again as the other kind
                       └─▶ "repository-changed" { version: 5, folderId, gitDir, paths,
                                                  kindChanged }
                             └─▶ frontend invalidates ['repository', folderId, …]
                                 (kindChanged: reset; commits and staged diffs only when
                                 gitDir; the open file, diff and colors only when paths touch
                                 them; paths null over 100 or when unknown)
                                   ├─▶ get_repository_snapshot   status + numstats, with summary
                                   ├─▶ get_repository_summary    level 0 only
                                   ├─▶ get_file_diff             one file, one area
                                   ├─▶ get_recent_commits        only while unfolded
                                   ├─▶ get_directory             each open folder, from memory
                                   ├─▶ get_recent_files          only while Recent shows
                                   ├─▶ get_file_content          the unchanged file shown
                                   ├─▶ get_markdown_preview      a Markdown file as it reads
                                   ├─▶ get_file_stamp            an image's size and mtime
                                   └─▶ get_syntax_colors         blocks of lines on screen
```

- A commit's files and diffs never change: cached under `['commit', …]`, read once; so does a git
  object's size (`get_blob_size`, a side of an image's diff), under `['blob', …]`.
- Commands name a project by its id and serve only projects in the list; the core reads a folder
  by its root on the machine that holds it (`features/wsl.md`).

## Frontend

- `app/`: composition root: providers, shell (top bar, levels, tiles), keys and zoom gestures,
  panels (`panels.ts`), problems.
- `modules/`: `projects` (list, level 0 rows, dialogs), `repository` (Changes and Files, the
  folder's kind; `model/` wire types and parsers, `application/` port and queries, `ui/`),
  `notes`, `search` (the palette; ranking and reading are the backend's), `settings`. Each panel
  module one lazy chunk.
- `infrastructure/`: the two implementations of `RuntimePorts` (`runtime-ports.ts`), `tauri/` (the
  backend) and `fixtures/` (in memory, for the browser), a file per port in each; `app/` picks one, `DevModePage.tsx` the fixtures in a chunk
  loaded only in dev builds. `shared/`: tokens, primitives, session state (`useSessionState`),
  keys, errors, i18n, the panel contract, the project type.
- Rules (`pnpm boundaries:check`): `app` composes and owns no workflow state; `modules` never import
  `app`, `infrastructure` or another module; outside a module only its `index.ts`;
  `infrastructure` never imports `app`; `shared` imports only `shared`; `@tauri-apps/*` only in
  `infrastructure/tauri/`; `infrastructure/fixtures/` only from `app/DevModePage.tsx`; only
  `shared/projects/` reads a location's variant (`project-place.ts`), the fixtures aside.
- Panels: `PanelDefinition` (`shared/panels/panel.ts`): id, title, icon, lazy component, needs,
  optional `summary` and `tileMinWidth`. `PanelProps`: `project`, `header` (a portal), `tileFit`,
  `target` (a request in the panel's terms) and `targetTaken`, `place` (`tile`/`full`), `selected`
  (takes the keys), `show(panel, target)`, `findInFiles(text)`. A panel remounts per project and
  zoom; what must survive lives in `useSessionState`.
- Panel requests: a target is a change to what a panel shows, never what it shows. Each
  field is state, written once into its one owner (the selection with its marked lines, the find
  bar, the open list), or an effect done once (open on a hunk or lines, bring a note into view,
  focus a field); then the panel calls `targetTaken` and `AppShell` forgets it, so a remount
  (minimize and restore, zoom, another folder and back) never applies it again. A request is for
  one panel of one project and folder (`app/asked.ts`); it waits while that panel mounts (a lazy
  chunk, a project being entered, a tile in the top bar, which comes back for it); a zoom without
  target drops it. Kept as state, every mount would apply it again, over the user's choice.
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
  infrastructure (`settings_store.rs`, `stored_json.rs`, `notes_files.rs`, `files.rs`, `logging.rs`,
  `system_shortcuts.rs`, `capture/`, `window/`: the window as a quick note).
- Files the app writes (notes, settings and projects, an export) go through `files.rs`'s
  `write_whole`: beside the file, `sync_all`, renamed over, so a crash or a full disk leaves the
  previous file, never half of one. Reads are bounded (`read_within`, the notes' too).
- Settings and projects: one `settings.json` in app data (`settings`, `projects`), read at startup
  for what reads (`stored_json.rs`): a value that does not (a typo, another version's) takes its
  default, the values beside it still read; a project that does not is left out. Each change
  writes the file whole under one lock, storing only what changed since it was read: a value or a
  project not read, or one this version does not know, stays as stored, so an older version run
  on the same data (a development build, a downgrade) loses nothing of a newer one's. A file whose
  text does not read is set aside as `settings.unreadable.json` (one, replaced) and the app starts
  from the defaults; one the disk does not give (a lock, a permission) or that cannot be set aside
  is never written over that session. No store plugin: tauri-plugin-store 2.5.0 saves with a plain
  `fs::write` and starts empty on a file it cannot read, written over at the next save.
- `src-tauri/crates/core/` (`sidekyk-core`): no Tauri, which the compiler keeps out; the app runs
  all of it, the helper what reads a folder. Its items are `pub` for the app, so one the app stops
  using no longer warns.
  - `modules/folder/`: a project's folder, with or without git: the `RepositoryBackend` port (git,
    reads, `walk`, `folder_rules`, `real_path`) and the `RepositoryWatcher` port to the machine
    that holds it, its kind and root (`resolve_folder`), the tree and a file's content, path
    checks and read limits (`reading.rs`), the ignored-paths filter, which changes matter
    (`watched.rs`, `FolderChanges`) and which folders to watch (`folders.rs`), its wire
    contracts. No disk of its own.
  - `modules/repository/`: git's review over `folder`: parsers, snapshot, diffs, commits,
    versions. `repository` imports `folder`, never the other way.
  - `modules/reader/`: one machine's folders as the app reads them, repositories or not: the
    `Repositories` port, one method per read, and `LocalRepositories` (coalesced reads, the
    cached tree, the last content search, `ColorCache`, the watched folder, `watch.rs`).
  - `modules/projects`, `settings`, `search` (pure ranking), `notes` (`NotesStore` over
    `NotesStorage`), `syntax`, `preview` (Markdown to the preview's tree, pure), `diagram`
    (Mermaid to an SVG with merman, pure).
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
- Paths after `--` are literal: `--literal-pathspecs` on diff, diff-tree and the
  snapshot's numstats, else `[id].tsx` also matched `i.tsx` and a file's diff held both. Not
  `GIT_LITERAL_PATHSPECS` for every command: `check-ignore` refuses it.
- Bounded (`limits.rs`): status 8 MiB, numstat 4 MiB, diff 2 MiB, ls-files 32 MiB, `check-ignore`
  its input; past the limit git is killed and the output `truncated` (cut records dropped, diffs cut
  at a line). stderr 64 KiB. 30 s → `git_timed_out`.

### Watching

- macOS and Windows: one recursive watch of the root (and of the git dir when outside it).
- Linux (the app and the helper): inotify watches one folder at a time, and notify's
  recursive watch took every folder, `node_modules/` included, and gave up the project at the first
  failure (`max_user_watches`); fanotify needs `CAP_SYS_ADMIN`. So, as VS Code
  (`@parcel/watcher`) and Zed, `folders.rs` watches each folder git does not ignore
  (`check-ignore` once per level), each before reading it, not inside a submodule nor through a
  link; in the git dir itself, `refs/`, `info/`. A folder a batch created is watched before the
  change is told; one created while hidden when the window shows. A `.gitignore` changed: every
  folder looked at again. At the system's limit the watches stay, one `warn`, no more asked
  (8,192 before Linux 5.11, then 1% of RAM within 8,192-1,048,576).
- Reports: while an agent writes, the debouncer gives ~8 batches a second (its next
  deadline is the oldest pending path's last event + 250 ms), each a `check-ignore` and a snapshot
  (~165 ms CPU). `REPORT_INTERVAL` (1 s, `watcher.rs`, a thread per watch): the first batch after a
  quiet second at once, the next ones joined and told when the second ends; no timer while idle;
  before `check-ignore`, so in the helper too. `.local/snapshot-churn/` (M4, CPU with git): 200
  writes in 3.7 s 5.8 → 1.4 s, one every 0.5 s for 20 s 8.4 → 4.4 s, one every 1.5 s even; first
  change ~360 ms, the last ≤ 0.75 s after the agent stops. Not 1.5 s (the last 1.7 s late), not
  the debouncer's timeout at 1 s (the first in 1.4 s), not 5 s (too stale to watch an agent).
- A folder without git: no git dir; `FolderChanges` drops what the walk's rules hide
  (`folder_rules`: `ignore`'s `IncrementalIgnore` from the walk's own builder, so both agree,
  global excludes included); on Linux `folders.rs` keeps those folders out too. An ignore file
  changed: rules read again.
- Kind: a batch with `<root>/.git` that no longer matches the watch restarts it as the other kind
  on its own thread and tells `kind_changed`, also while hidden (rare, no git).
- A repository inside the root (a submodule, a clone, Claude Code's
  `.claude/worktrees/` unless ignored): `git status` shows its folder, never its files, yet
  `check-ignore` calls them visible. `ignored.rs` drops paths under a folder holding a `.git` (the
  disk asked once per folder of a batch, +1 ms on 5,000 paths), as Linux by not watching them.
- Events the system dropped (`IN_Q_OVERFLOW`, `MustScanSubDirs`): notify's pathless
  event, which the debouncer drops, goes as `Changed::Unknown`: git dir and any path may have
  changed, folders rescanned on Linux, the project marked if hidden. Windows: notify 8.2.1 loses
  both forms (a 0-byte completion; `ERROR_NOTIFY_ENUM_DIR`, which also ends the watch), 9.0.0-rc.5
  rescans (notify-rs#964).

### Logs

`tracing` to the app's log dir (one file per session, the previous kept, a size cap). Dev builds:
every git call, batch and command duration, also on stderr. The level applies to the app, the core
and the helper's lines (target `helper`). Release compiles out below `info` (+144 KiB): startup
(version, OS, architecture, the WebView's version), each page load (a second for one webview: it
crashed and reloaded), project opened, the window's visibility, failures, panics with their
backtrace (function names only in a release, which strips line tables), frontend errors (50 per
session). Crash dumps are the system's (macOS's crash reports, Windows Error Reporting), not
the app's.
Hot-path events are `debug`. A command's failure is logged once until that command succeeds
(`blocking.rs`): a read failing on every refresh writes one line, not one a second.
