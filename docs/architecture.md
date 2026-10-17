# Architecture

Sidekyk is a Tauri 2 desktop app with a React/Vite frontend in `src/` and a Rust backend in
`src-tauri/`. It follows the same pragmatic modular-monolith layout as Fyler, scaled down to one
workflow.

## Data flow

```text
agent edits files ─▶ notify watcher of the project on screen (250 ms quiet period, filtered)
                        └─▶ dropped while the window is hidden, minimized or covered
                        └─▶ skip paths git ignores (check-ignore, cached per directory)
                        └─▶ event "repository-changed" { version: 1, root, gitDir }
                              └─▶ frontend invalidates ['repository', root, …] queries
                                  (the recent commits only when gitDir: index, HEAD or refs)
                                    ├─▶ get_repository_snapshot(root)  (status + numstat ×3,
                                    │                                   its summary included)
                                    ├─▶ get_repository_summary(root)   (only when no snapshot
                                    │                                   brings it: level 0)
                                    ├─▶ get_file_diff(root, …)         (one file, one area)
                                    ├─▶ get_recent_commits(root)       (only while unfolded)
                                    ├─▶ get_directory(root, path)      (each open folder, from
                                    │                                   the backend's file list)
                                    └─▶ get_file_content(root, path)   (the file open in Files)
```

The files a commit changed and their diffs (`get_commit_files`, `get_commit_file_diff`) are read
once, when asked for: a commit never changes, so they are cached under `['commit', root, …]`,
apart from the repository's keys, and no change on disk or window shown reads them again.

Projects are the repositories the user added (`get_projects`, `add_project`, `activate_project`,
`remove_project`). Commands name a repository by its root, and the backend serves only roots in the
project list. Only the project on screen is watched; the others cost nothing until shown.

The other projects show their summary (`get_repository_summary`: status and one numstat against
HEAD, new files not read) on the rail and on the level 0 cards. It is fetched once the first
paint is done, again when the window shows after being hidden (an agent may have worked on any
project while the user was away), and again each time level 0 shows, for its cards and with
them the rail; in both cases only when the summary is older than 30 s. The projects not on
screen are not watched: nothing refreshes them while the window stays in front on another view.

While the window is hidden, minimized or covered by other windows (WKWebView follows the
window's occlusion on macOS), nothing runs git. The page tells the backend when it becomes hidden
or visible (`visibilitychange`, through `set_window_visible` in `window.rs`). The watcher keeps
watching but drops its batches before `check-ignore`, and only marks the project when a batch may
show: a path outside the ignored directories it already knows, or the git dir. When the window
shows again, `set_window_visible` answers with the marked project, if any, and the frontend reads
again what is on screen of it, and anything on screen read more than 30 s ago: the summaries of
the projects not watched, and the project on screen too, as a safety net for changes the watcher
cannot see (a repository on a network drive). Shown again within 30 s with nothing changed, as
when switching back and forth with the agent's terminal, nothing runs.

## Frontend

### Directory map

- `src/app/` — composition root: providers (`QueryClient`, runtime ports, the toasts), the shell
  (top bar with the breadcrumb, the problems and the settings' gear, the zoom levels, panel
  tiles), the keyboard and the zoom gestures (see Zoom and keyboard), the list of panels
  (`panels.ts`). May depend on everything.
- `src/modules/projects/` — the project list: port and queries, the project rail, level 0's
  cards (`ProjectsOverview`, a chunk of its own with Base UI's menu, fetched once the window is
  idle after the first paint), the screen shown before the first project.
- `src/modules/settings/` — the settings: port and queries, and the dialog (a chunk of its own
  with Base UI's dialog and radio group, fetched once the window is idle after the first paint).
- `src/modules/search/` — the command palette: port and query (the ranking is the backend's),
  the rows it shows (`model/palette-rows.ts`), and the palette (a chunk of its own with Base UI's
  dialog and autocomplete, fetched once the window is idle after the first paint). What it opens,
  the app decides (`PaletteActions`).
- `src/modules/repository/` — the repository on screen, shown as two panels (`panel.ts`):
  Changes, the review workflow and the viewer of any file, and Files, the project's files as a
  tree. In a tile Files is the tree alone and shows the file picked in Changes; full screen it has
  the viewer too.
  - `model/` — pure logic and wire types: unified-diff parser, agent snippet format, file grouping,
    the tree's rows, change colors and keys (`file-tree.ts`), and what one panel asks the other to
    show (`targets.ts`).
  - `application/` — `RepositoryPort` (context-provided), the TanStack Query hooks, the commit
    looked at in place of the working tree (`useCommitView`), and what the panels keep of a project
    for the session (`useSessionState`, a store every component on the same key reads live): the
    file shown, one selection for both panels (`useSelectedFile`, `model/selection.ts`), and the
    tree's open folders and row; what a panel is asked to show (`useShownTarget`); and the
    settings the app passes to both panels (`RepositorySettings`); a panel is mounted again for each project and each zoom, and
    comes back as it was.
  - `ui/` — the Changes panel (`ChangesWorkspace`), file list, the recent commits
    (`RecentCommits`) and a commit's files (`CommitFileList`) on the same virtualized rows
    (`useVirtualRows`); the viewer (`Pane`: the rows, their copy, the hunk being read), with a
    diff on it (`ChangeDiffView`, `CommitDiffView`) or a file's text (`TextFileView`), and the open
    file in the panel's header (`FileHeader`, one for every file both panels show); the Files
    panel (`FilesWorkspace`) and its tree (`FileTree`, laid out by `tree-layout.ts`); the summary's views: the project's facts in the
    breadcrumb, the change count on the rail, the level 0 card's part (a chunk of its own, loaded
    with level 0). The lists, the tree and the diff are virtualized (`@tanstack/react-virtual`):
    they are flat lists of fixed-height rows (`fileListRows`, `treeRows`, `diffRows`) and only the
    rows on screen are in the DOM.
- `src/infrastructure/platform/` — Tauri adapters (`invoke`, `listen`, the window) implementing
  the ports, including the title bar's (`TitleBarPort` in `shared/platform`: whether macOS's
  traffic lights overlay the top bar, which full screen turns off).
- `src/shared/` — stable primitives: theme tokens, button/chip primitives, the clipboard hook and
  copy icon, error messages, shortcut labels and modifiers (`⌘` or `Ctrl`,
  `platform/shortcut.ts`, from `platform/macos.ts`), which keys a field or an overlay takes
  (`ui/keys.ts`), the toasts' port (`ui/toasts.ts`), the zoom transition and preloadable lazy
  parts (`ui/`), the project type every layer shares (`projects/project-info.ts`), the change
  areas and their labels (`git/change-area.ts`, for Changes and the palette), and the panel
  contract (`panels/panel.ts`).
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
component loaded with `import()`, one chunk per module. The component receives the project it shows
(`PanelProps`), so panels never ask which project is active. `src/app/panels.ts` lists them in
shortcut order and starts loading the startup panel's chunk as soon as the app's code runs, so it
does not wait for the first render. The shell renders a panel inside `Suspense`; a panel's queries
live in its component, so a panel that is not on screen runs none. The panel gets its header too
(`PanelProps.header`), an element it fills through a portal with what is open in it and its actions:
in a tile, after the panel's title; full screen, a header shown only while the panel puts something
in it. A panel may also give a `summary`: its part of a project's card at level 0, a chunk of its
own fetched with level 0. The app can ask a panel to show something (`PanelProps.target`, a key in
the panel's own terms that its module builds, such as `changesTarget` for a changed file): the
command palette opens a file this way. Each request is a new object; without one, the panel stays
as the user left it. A panel asks the app to show something in another (`PanelProps.show`, with
that panel's target): Changes and Files show each other's file, at the hunk being read, and the
Files tile shows the file picked in Changes, leaving the keys to the tree (`select: false`). At
level 1 the panels are tiles side by side (`TILES`: Changes takes the room the tree of Files
leaves), and one is selected: the one clicked, or reached with `←`/`→`. A panel knows where it is
(`place`, a tile or full screen) and whether it takes the keys (`selected`): in a tile only
letters (`j`/`k`, `Space`), full screen every key of its own.

### Zoom and keyboard

`AppShell` owns the zoom level and the panel full screen; every change of level goes through its
`zoom`, which runs it inside a view transition (`shared/ui/zoom-transition.ts`): the project and
its card share one `view-transition-name`, a panel's tile and its full screen another, so the zoom
grows one into the other. Level 0, the settings dialog and the panels are `preloadable` parts
(`shared/ui/preloadable.ts`): once their chunk is loaded they render at once, where `lazy` would
suspend for a frame and the transition would capture an empty screen.

The keys are one listener (`app/workspace-keys.ts`): `↵`/`Esc` zoom, `1`-`9` panels, `←`/`→`
tiles at level 1, `[`/`]` projects, `⌘,` settings. A key that a field, a dialog or a menu takes is
left to it (`shared/ui/keys.ts`; the panels listen with `useWindowKeys` and keep only
`isOwnKey`s). A panel that takes `↵` or `Esc`
listens while capturing, so it comes first, and the workspace skips a key already handled. `⌘`/`Ctrl`+scroll and the pinch
are `app/zoom-gestures.ts`: the wheel listener exists only while the modifier is held, since a
wheel listener that may cancel makes every scroll wait for the main thread.

### Toasts and problems

A passing event is a toast: a module calls `useShowToast()` (`shared/ui/toasts.ts`), today when a
change to the project list fails, since the screen that asked for it may be gone. The app renders
them (`app/providers/toasts.tsx`) with Base UI's toasts, a chunk loaded with the first one; the
toasts that come while it loads wait in a queue (`toast-queue.ts`). A dialog that is open shows its
own errors inside it, as the settings do.

What stays wrong until fixed is a problem, in the top bar with its fix (`app/problems.ts`). The
problems are read from the caches, never fetched: a repository whose last read failed with
`repository_missing` (`useMissingRepositories` in the changes module, over the query cache), fixed
by removing its project. The warning and its popover are a chunk loaded with the first problem.

### State

There is no client store. Git is the state: the project list, the snapshots, the summaries and
the diffs are TanStack Query caches, the last three keyed by repository root first, so a change on
disk refetches only that repository. A snapshot stores its summary in the summary's cache, and the
project in the Changes panel never fetches a summary of its own. UI state is the zoom level and
the selected tile (`AppShell`); the file shown of each project, shared by both panels (a changed
file, or a path of the tree, shown as a change while it is one), which Changes selects in its list
and Files reveals in its tree; in `ChangesWorkspace` the commit looked at, if any, with its file
open; in `FilesWorkspace` the open folders and the row the keyboard is on. They are kept per
project for the session, not on disk; the tree's width is a setting. Switching project updates the cached list
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

The window is created hidden and shows once the page has the workspace laid out: `AppShell` calls
the `showWindow` runtime port when the project list is read (`show_window`), so startup shows no
blank frame and no empty shell. The Changes panel asks for its snapshot in that same render, and
on macOS the snapshot and the first diff are usually back before the window is on screen. Only
the first call counts, so a page loaded again does not show a window closed into the tray. If
the page never calls it (a script that failed to load), the backend shows the window after 3 s.

## Backend

- `bootstrap/` — plugins (single instance, dialog, store), managed state, command list. Creates
  the window (`create: false` in `tauri.conf.json`) hidden, in the theme of the settings, and
  shows it at the latest 3 s later (see State), puts the icon
  in the tray, restores the projects, and adds and shows the repository of the first CLI
  argument, if any. On macOS a click on the Dock's icon brings back a window closed into the
  tray.
- `interfaces/tauri/` — commands (`projects.rs`, `repository.rs`, `search.rs`, `settings.rs`,
  the window's visibility in `window.rs`, and `log_frontend_error` in `diagnostics.rs`), the
  tray (`tray.rs`, see Tray), and `state.rs`, the one place that changes the project
  list and watches the project on screen. Blocking work runs on `spawn_blocking` (`blocking.rs`). At
  most one snapshot and one summary per project run at a time: requests that arrive during one share
  the next (`shared/coalesce.rs`), so a burst of refreshes costs two snapshots, not one per request.
- `modules/projects/` — the project list: adding, activating, removing, and a stored list made
  consistent. No Tauri.
- `modules/settings/` — the settings and their defaults (`Settings`, `Theme`). No Tauri.
- `modules/search/` — the command palette's ranking (`rank.rs`, over `nucleo-matcher`) and its
  wire contracts. Pure: it gets what to search. No Tauri.
- `modules/repository/` — porcelain v2 and numstat parsers, snapshot assembly, diff loading, the
  recent commits (`commits.rs`), the files as a tree and a file's text (`tree.rs`), path
  validation, the ignored-paths filter for watcher events, wire
  contracts. A repository moved or deleted after it was added fails its snapshot and diffs with
  `repository_missing`, before git runs. No Tauri; the outside world is the `RepositoryBackend`
  port.
- `infrastructure/` — `git_cli.rs` (the `git` CLI, found on PATH or in the usual install dirs,
  every call bounded: see Git limits),
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

A snapshot lists at most 10,000 changed paths, as VS Code's `git.statusLimit`: past them (an
unignored `node_modules`), the list and the count of files stop there and the summary says
`truncated`. Changes then says so above the list, and the counts read `10000+`, in the
breadcrumb, on the card and in the tray.

### Git limits

The limits shared by the snapshot, the diffs and the recent commits are in `limits.rs`. Every
git call names the most output it reads (`max_stdout`, part of the `RepositoryBackend`
port): `git status` 8 MiB, a numstat 4 MiB, a diff 2 MiB, `check-ignore` the size of its input.
Each pipe is read on a thread of its own while git writes, so past the limit git is killed
instead of read to the end, and what was read comes back `truncated`: the last record of a cut
status or numstat is dropped, a cut diff ends at its last whole line. stderr keeps its first
64 KiB and drains the rest, so git never blocks on it. No call takes more than 30 s: past it git
is killed and the call fails with `git_timed_out`, which the panels show like any error, so a
hung command (a network drive) cannot hold a coalesced snapshot forever. A reader thread left
behind (a filter git started still holding the pipe) ends when the pipe closes. The threads
cost nothing measurable: a snapshot of Zed's clone takes 57 ms before and after.

### Search

The palette calls `search` at every key typed, with the query and the panels' titles (the
frontend defines the panels). The backend ranks, in groups, the projects' names, the panels'
titles and the changed paths of the project on screen, which `state.rs` keeps from its last
snapshot: no git runs for a search, and a snapshot that fails leaves nothing to search. With
nothing typed, every project and panel come back in their order and no file. Each word of the
query matches on its own, in any order, case ignored; the matched letters come back as UTF-16
offsets, which the frontend draws in bold. At most 500 files are sent; the rest are counted.
`backend_timings` measures a search over every tracked path of a repository.

### Tray

The tray's icon shows how many files changed in the project on screen: next to the icon on
macOS and Linux, in its tooltip everywhere (Windows has no text next to tray icons). The count
comes from every snapshot or summary of the project on screen (`repository.rs`), so the tray
runs no git of its own and stays as it was while the window is hidden. Switching project clears
it until the next snapshot. Its menu shows the window or quits; on Windows a click shows the
window and the right button opens the menu, on macOS and Linux a click opens the menu. macOS
draws a monochrome template glyph (`icons/tray-template.png`, Tabler's `git-compare` until the
app has its own icon) in the menu bar's colors; the other systems show the app's icon.

While the icon is in the tray, closing the window hides it (`window.rs`); quitting is in the
menu, and `⌘Q` on macOS. On Linux, Tauri loads libayatana-appindicator3 (or libappindicator3)
at runtime and panics without it: the panic is caught, the app runs with no tray, and closing
the window quits.

### Recent commits

The Changes panel's list ends with the recent commits, as VS Code's source control does, closed
until opened; a commit clicked there shows its files in the list instead of the working tree's,
on a tinted background under a card of the commit, until its × or `Esc` goes back to the working
tree and closes the commits. `load_recent_commits` runs `git log -z
--first-parent -n 51 HEAD` (one more than the 50 listed, to know whether older ones exist): the
branch's own history, which the list draws as one line, a merge standing for the commits it
brought. `--ignore-missing` makes a branch with no commit yet list none, and
`--no-show-signature` keeps a `log.showSignature` in the user's config from running gpg. Each
commit comes with its first parent: a commit's files (`git diff-tree -r -z --raw --numstat -M`,
at most 10,000) and a file's diff (`git diff-tree -p`) compare it with that parent, or with
nothing for a root commit (`--root`), so a merge shows what it brought to its branch, as in VS
Code. The ids come from the frontend and must be hashes (`invalid_commit` otherwise), so they can
never be read as an option. Every call has the limits of the others (see Git limits).

### Files

The Files panel's tree comes from one list of files: `git ls-files -z --cached --others
--exclude-standard`, with `git ls-files -z --deleted` in parallel to leave out the tracked files
deleted from disk (the Changes panel lists them), so the tree holds what `git status` sees and
nothing git ignores. At most 200,000 files, from 32 MiB of output: past them the tree says so.
`FileTree` keeps it as folders, each sorted as VS Code's explorer (folders first, case ignored,
numbers by value), and `get_directory` answers what one folder holds from memory, at most 10,000
entries and the rest counted; a folder holding only one folder shares its entry with it, down to
one that holds more ("modules/changes").

`state.rs` keeps the tree of the project on screen only, read when first asked for. A watcher
batch drops it when the git dir changed, or when one of its paths not ignored was added or removed
(`FileTree::may_have_changed`: on disk and not in the tree, or the other way round): an edit to a
file keeps it. The batch's event refetches the open folders, and the first one reads the list
again; a read under way when the files changed is not kept. While the window is hidden a marked
batch drops the tree too, and switching project drops it, since its watcher's events are gone.

`get_file_content` reads only a file of the tree (`ProjectsState::file_content`), through the
backend port (`read_entry`): its
first 2 MiB, cut at the last whole line, or binary with a NUL in its first 8 KiB as git decides. A
link is never followed: its target comes back as text. A folder on the way that is a link reads
nothing, so no path leaves the repository. A folder git lists as a file is a submodule.
`backend_timings` measures the list and a folder.

### Diffs

`git diff [--cached] --no-color --no-ext-diff -U3 -- <path>`; a staged rename passes both paths;
an untracked file uses `--no-index /dev/null <path>`. Output larger than 2 MiB is cut at a line
boundary and flagged `truncated` (see Git limits). The frontend parses the text, so user settings such as
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
