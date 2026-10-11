# Roadmap

What Sidekyk does today and what is still missing, in priority order. Sidekyk is growing from a
changes viewer into a project workspace (changes, files, notes, several projects); the direction,
the decisions taken and the open ones are in [docs/evolution.md](docs/evolution.md). Items move to
**Done** as they land; each one keeps repositories read-only and follows the performance golden
rule in `AGENTS.md`.

## To do

- [ ] Run the app (`pnpm tauri:dev`) after the performance work: the watcher filter, snapshot
      coalescing and the rlib-only crate type are covered by tests and fixtures, but have not been
      seen in the real app yet

## Done (MVP)

- [x] Open a repository from a folder picker, the first CLI argument, or the last one used
- [x] Summary bar: branch, ahead/behind, changed files, lines added/removed against HEAD,
      uncommitted indicator
- [x] File list grouped as changes, new files and staged, with per-file line counts
- [x] Unified diff per file, with line numbers, binary and truncation notices
- [x] Automatic refresh on file and ref changes (filtered, debounced watcher) and on window focus
- [x] Copy a hunk or a whole file for an agent (`path:lines` plus a `diff` block)
- [x] Keyboard navigation between files (`↑`/`↓`, `j`/`k`)
- [x] Light and dark theme following the system
- [x] Browser fixtures (`?dev=app&scenario=…`) for UI work without Tauri

## Now: performance and hardening

- [x] Ignore changes in gitignored paths (`git check-ignore --stdin`, cached per directory and
      cleared when a `.gitignore` changes), so a build or a dependency install does not refresh
      the app over and over
- [x] Run the snapshot's git commands in parallel (`std::thread::scope`)
- [x] At most one snapshot in flight per repository; later requests coalesce into it
- [x] Bound the total bytes and the number of untracked files read for line counts
- [x] Virtualized diff and file list for very large changes (`@tanstack/react-virtual`)
- [x] Release profile with LTO and one codegen unit
- [x] Run git with `-c core.fsmonitor=false`, so a repository's config cannot run a command on
      every refresh
- [x] Snapshot and diff timings on any repository (`backend_timings`)
- [ ] First paint and file switch timings as a repeatable script (today measured by hand on the
      `large` fixture), and the same in the packaged app

## Next: workspace foundation

- [ ] Panel model: one module per panel with a common contract (id, title, icon, component,
      summary for the overview); panels off screen run no queries and load lazily
- [ ] Projects as app data, replacing the single last repository: add, remove, switch. Only the
      active project runs snapshots; the others keep a light watcher that only marks changes
- [ ] Semantic zoom levels 1 and 2: a project's panels as tiles or tabs, and one panel full
      screen, with the Changes panel as today's view; breadcrumb and project rail as in the
      approved mock (docs/evolution.md)
- [ ] Command palette (`⌘K`): projects, panels, files, notes
- [ ] Keyboard model of the mock: `↵`/`Esc` zoom (progressive `Esc`), `1`-`3` panels, `[`/`]`
      projects, `⌘`+scroll and pinch

## Next: see what the agent is doing

- [ ] Tray icon with the change count, and a menu to show the window or quit
- [ ] Global shortcut to show and hide the window (configurable)
- [ ] Closing the window hides it instead of quitting; quit from the tray
- [ ] Badge or tray hint when the agent changes files while the window is hidden
- [ ] Compare against the default branch, for agents that commit as they go: diff the working
      tree against the merge base (`git diff --merge-base <default>`), so commits and uncommitted
      edits show together and an edit that undoes a commit shows as unchanged. The default branch
      comes from `upstream/HEAD`, `origin/HEAD` or `init.defaultBranch`; without one, stay on HEAD

## Then: explore the repository

- [ ] Files panel: tree from `git ls-files` plus untracked files, virtualized
- [ ] File view through the backend, size-limited, on the virtualized rows of the diff view
- [ ] Search by name (fuzzy)
- [ ] Search in contents in the backend (`git grep` or ripgrep's crates), streaming and
      cancellable

## Then: notes

- [ ] Notes panel, stored at application level in the app data directory (format and granularity
      decided at implementation)
- [ ] Optional sync and backup with Google Drive: OAuth 2.0 for desktop apps (loopback, PKCE),
      tokens in the OS credential store, sync in the backend, local first, conflicts kept as both
      versions (see docs/evolution.md for the checked facts and the open decisions)

## Then: all projects at a glance

- [ ] Semantic zoom level 0: one card per project (changes in progress, last activity, notes),
      doubling as the project switcher

## Then: feedback to the agent

- [ ] Copy selected lines, not only whole hunks
- [ ] Collect several hunks with a short comment each, then copy them as one batch

## Review

- [ ] Syntax highlighting, loaded lazily
- [ ] Side-by-side view
- [ ] Collapse unchanged regions and expand context on demand
- [ ] Open a file in the editor at the hunk's line

## App

- [ ] Settings: theme override, shortcut, diff context lines
- [ ] Italian and English UI (as in Fyler)
- [ ] Real app icon

## Release

- [ ] CI running the same checks as `AGENTS.md`
- [ ] Signed release builds and self-update (as in Fyler)
- [ ] Linux and Windows testing

## Out of scope

- Writing to git: staging, committing, reverting. Sidekyk only shows; the agent or the terminal
  changes things.
- Editing files: the explorer only shows them; "open in editor" is the way to change one.
- Running or embedding the agent.
- Replacing the `git` CLI with an in-process library (`gix`, libgit2) while process startup is
  not what the timings show as slow.
