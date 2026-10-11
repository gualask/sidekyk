# Roadmap

What Sidekyk does today and what is still missing, in priority order. Sidekyk is growing from a
changes viewer into a project workspace (changes, files, notes, several projects); the direction,
the decisions taken and the open ones are in [docs/evolution.md](docs/evolution.md). Items move to
**Done** as they land; each one keeps repositories read-only and follows the performance golden
rule in `AGENTS.md`, and says what it costs while the window is hidden and while it is shown.

The feature set comes first. Performance work that is a sure win is part of the items below;
what needs measuring before deciding waits in **Performance review**, at the end.

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

## Done: performance and hardening

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
- [x] Seen in the real app (git calls traced with `GIT_TRACE`): startup runs one snapshot and one
      diff, writes in an ignored directory cost one `check-ignore` and then nothing, an edit or a
      commit refreshes within about 300 ms
- [x] Structured logs (`tracing`): detailed in development, compiled out of release builds below
      `info`, where only startup, failures and panics are kept for bug reports (+144 KiB on the
      release binary)

## Next: workspace foundation

- [x] Panel model: one module per panel with a common contract (`PanelDefinition` in
      `src/shared/panels`: id, title, icon, lazy component), composed in `src/app/panels.ts`;
      panels off screen run no queries, and each loads as its own chunk, the startup panel's
      fetched with the app instead of after the first render. Costs nothing hidden or shown
- [ ] Panel summary for the overview and the tile headers (the Changes count), added to the
      contract with level 0, once projects say where the data comes from
- [ ] Projects as app data, replacing the single last repository: add, remove, switch. Only the
      active project runs snapshots; the others keep a light watcher that only marks changes
- [ ] Semantic zoom levels 1 and 2: a project's panels as tiles or tabs, and one panel full
      screen, with the Changes panel as today's view; breadcrumb and project rail as in the
      approved mock (docs/evolution.md)
- [ ] Command palette (`⌘K`, `Ctrl+K` on Linux and Windows): projects, panels, files, notes
- [ ] Keyboard model of the mock: `↵`/`Esc` zoom (progressive `Esc`), `1`-`3` panels, `[`/`]`
      projects, `⌘`/`Ctrl`+scroll and pinch

## Next: see what the agent is doing

- [ ] Tray icon with the change count, and a menu to show the window or quit
- [ ] Global shortcut to show and hide the window (configurable)
- [ ] Follow the terminal (setting, off by default): when Sidekyk comes up, open the project of the
      terminal tab used just before it; kitty on macOS first, other terminals and systems when
      needed; any failure leaves the current project (see docs/evolution.md)
- [ ] Closing the window hides it instead of quitting; quit from the tray
- [ ] No work while the window is hidden or minimized: the watcher only marks the project as
      changed, and the snapshot runs when the window comes back. Today every change refetches the
      snapshot and the open diff even when nobody looks
- [ ] Badge or tray hint when the agent changes files while the window is hidden, from the
      watcher's mark alone (no git while hidden)
- [ ] Create the window hidden and show it after the first paint: no blank frame at startup
- [ ] Compare against the default branch, for agents that commit as they go: diff the working
      tree against the merge base (`git diff --merge-base <default>`), so commits and uncommitted
      edits show together and an edit that undoes a commit shows as unchanged. The default branch
      comes from `upstream/HEAD`, `origin/HEAD` or `init.defaultBranch`; without one, stay on HEAD

## Next: bounded git

Before the explorer adds more git reads, so they all share the same limits.

- [ ] A timeout on every git call that kills git, so a hung command (network drive, huge
      repository) cannot hold the coalesced snapshot forever; the frontend shows the state
- [ ] Bound reads while reading, not after: stop reading a diff at 2 MiB and kill git instead of
      buffering the whole output and cutting it; cap the entries read from `git status`, with a
      "too many changes" state (an unignored `node_modules`)

## Then: explore the repository

- [ ] Files panel: tree from `git ls-files` plus untracked files, virtualized, with a bounded
      payload
- [ ] File view through the backend, size-limited, on the virtualized rows of the diff view
- [ ] Search by name (fuzzy)
- [ ] Search in contents in the backend (`git grep` or ripgrep's crates), streaming and
      cancellable

## Then: notes

- [ ] Notes panel, stored at application level in the app data directory (format and granularity
      decided at implementation)
- [ ] Optional sync and backup with Google Drive: OAuth 2.0 for desktop apps (loopback, PKCE),
      tokens in the OS credential store, sync in the backend, local first, conflicts kept as both
      versions (see docs/evolution.md for the checked facts and the open decisions). Nothing of
      it starts until an account is connected

## Then: all projects at a glance

- [ ] Semantic zoom level 0: one card per project (changes in progress, last activity, notes),
      doubling as the project switcher

## Then: feedback to the agent

- [ ] Copy selected lines, not only whole hunks
- [ ] Collect several hunks with a short comment each, then copy them as one batch

## Review

- [ ] Syntax highlighting, loaded lazily, only for the rows on screen, and skipped above a size
      limit
- [ ] Side-by-side view
- [ ] Collapse unchanged regions and expand context on demand
- [ ] Open a file in the editor at the hunk's line

## App

- [ ] Settings: theme override, shortcut, diff context lines
- [ ] Italian and English UI (as in Fyler)
- [ ] Real app icon
- [ ] Copy or reveal the log from the app, for bug reports

## Release

- [ ] CI running the same checks as `AGENTS.md`, with the Rust tests on macOS, Linux and Windows
      (the end-to-end tests run a real git, so they catch path and process differences)
- [ ] Signed release builds and self-update (as in Fyler); the update check runs at startup or on
      demand, never on a timer
- [ ] Linux and Windows testing of the packaged app. On Linux, inotify needs one watch per
      directory: do not watch ignored directories, and handle the `max_user_watches` limit. On
      Windows, check that watcher paths (`C:\…`) match git's (`C:/…`) in the ignored-paths filter
      and the git-dir check, case included

## Performance review

Once the feature set is in. These need measuring before deciding; the first three give the
numbers the others are judged on.

- [ ] First paint and file switch timings as a repeatable script (today measured by hand on the
      `large` fixture), and the same in the packaged app
- [ ] Performance budgets in `docs/performance.md`, with a baseline measured on the packaged app:
      cold start to first paint, show from hidden, file switch, snapshot and diff on the
      reference repositories, idle CPU and wakeups, memory (app and WebView processes), bundle
      and binary size. A change that exceeds a budget says why in its commit
- [ ] Reference repositories for `backend_timings`: a small one, this one, a large one (tens of
      thousands of files, e.g. the Linux kernel) and an unignored `node_modules` with thousands
      of untracked files
- [ ] Idle footprint: CPU, wakeups and memory with the window shown and hidden, with nothing
      changing and during an agent's burst of writes (`powermetrics`, Activity Monitor's energy
      impact, `footprint`)
- [ ] Hiding the window: keep the WebView alive (instant show, its memory stays) or destroy it
      (memory freed, slower show)
- [ ] The tray's change count while hidden: the watcher's mark only, or a throttled `git status`
      without line counts
- [ ] Sustained churn: while writes never stop, `notify-debouncer-mini` reports every 250 ms, so
      the app runs a snapshot, the open diff and a `check-ignore` four times a second (measured:
      200 writes in 3 s gave 14 of each). Decide whether snapshots need a minimum interval, and
      whether paths git tracks can skip `check-ignore` (today only ignored directories are
      remembered)
- [ ] Focus refetch: skip it when the watcher reported nothing since a recent snapshot, or keep
      it unconditional as the safety net
- [ ] Prefetch the diffs next to the selected file, if file switching shows a visible wait
- [ ] Syntax highlighting and fuzzy search off the main thread, if they show up in the timings
- [ ] Files panel refreshed only when paths are added or removed, not on every edit (the
      debouncer reports paths, not event kinds)
- [ ] Bundle and binary size budgets checked in CI (timings stay manual: too noisy on shared
      runners)

## Out of scope

- Writing to git: staging, committing, reverting. Sidekyk only shows; the agent or the terminal
  changes things.
- Editing files: the explorer only shows them; "open in editor" is the way to change one.
- Running or embedding the agent.
- Replacing the `git` CLI with an in-process library (`gix`, libgit2) while process startup is
  not what the timings show as slow.
