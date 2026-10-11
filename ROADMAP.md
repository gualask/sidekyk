# Roadmap

What Sidekyk does today and what is still missing, in priority order: first seeing what the agent
is doing, then giving it feedback. Items move to **Done** as they land; each one should keep the
app read-only and follow the performance golden rule in `AGENTS.md`.

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
- [ ] Run the snapshot's git commands in parallel (`std::thread::scope`)
- [ ] At most one snapshot in flight per repository; later requests coalesce into it
- [ ] Bound the total bytes and the number of untracked files read for line counts
- [ ] Virtualized diff and file list for very large changes (`@tanstack/react-virtual`)
- [ ] Release profile with LTO and one codegen unit
- [ ] Run git with `-c core.fsmonitor=false`, so a repository's config cannot run a command on
      every refresh
- [ ] Timings for snapshot, diff and first paint, to measure every change against

## Next: see what the agent is doing

- [ ] Tray icon with the change count, and a menu to show the window or quit
- [ ] Global shortcut to show and hide the window (configurable)
- [ ] Closing the window hides it instead of quitting; quit from the tray
- [ ] Badge or tray hint when the agent changes files while the window is hidden
- [ ] Compare against the default branch, for agents that commit as they go: diff the working
      tree against the merge base (`git diff --merge-base <default>`), so commits and uncommitted
      edits show together and an edit that undoes a commit shows as unchanged. The default branch
      comes from `upstream/HEAD`, `origin/HEAD` or `init.defaultBranch`; without one, stay on HEAD

## Then: feedback to the agent

- [ ] Copy selected lines, not only whole hunks
- [ ] Collect several hunks with a short comment each, then copy them as one batch

## Review

- [ ] Syntax highlighting, loaded lazily
- [ ] Side-by-side view
- [ ] Collapse unchanged regions and expand context on demand
- [ ] Open a file in the editor at the hunk's line

## App

- [ ] Recent repositories in a switcher
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
- Running or embedding the agent.
- Replacing the `git` CLI with an in-process library (`gix`, libgit2) while process startup is
  not what the timings show as slow.
