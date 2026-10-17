# Roadmap

Priority order. Direction and decisions: `docs/evolution.md`; how things work:
`docs/architecture.md`. Every item keeps repositories read-only, follows the performance golden
rule (`AGENTS.md`) and states its cost hidden and shown. Performance work that needs measuring
first waits in **Performance review**.

## Done

MVP and hardening:

- [x] Open a repository (folder picker, first CLI argument, last used); file list grouped as
      changes / new files / staged with line counts; unified diff with binary and cut notices;
      watcher refresh (filtered, debounced); keyboard between files; browser fixtures
- [x] Ignored paths never refresh (`check-ignore`, cached per directory); snapshot's git in
      parallel; one snapshot in flight per project; untracked reads bounded; virtualized lists;
      `core.fsmonitor=false`; `backend_timings`; `tracing` logs (release keeps `info`+, +144 KiB)
- [x] Bounded git: every call names its max output (status 8 MiB, numstat 4 MiB, diff 2 MiB) and
      is killed past it or after 30 s (`git_timed_out`); at most 10,000 changed paths ("too many
      changes", counts read `10000+`)

Workspace:

- [x] Panel contract (`PanelDefinition`, one lazy chunk per module, no queries off screen) and
      level 0 summaries (status + numstat vs HEAD; 52 ms on Zed's clone)
- [x] Projects as app data: add, remove, switch (rail, `[`/`]`, `⌘K`); only the project on screen
      is watched; `repository_missing` for a moved repository
- [x] Shell of the approved mock: breadcrumb top bar (macOS overlay title bar), rail, level 0
      cards, level 1 tiles, level 2 full screen; zoom transitions (View Transitions, 320 ms)
- [x] Settings dialog (`⌘,`): theme (dark default), diff view, copy template, global shortcut
- [x] Toasts (passing events) and top-bar problems (lasting, each with its fix)
- [x] Command palette (`⌘K`): projects, panels, changed files, ranked in Rust (`nucleo-matcher`,
      0.34 ms / 4,366 paths; +199 KiB binary)
- [x] Keyboard model: `↵`/`Esc` zoom, `1`-`9` panels, `[`/`]` projects, `←`/`→` tiles at level 1
      (selected tile takes `j`/`k`), `⌘`+scroll and pinch (macOS) zoom; `?` (and the top bar's
      `?`) shows the shortcuts in a card, bottom right, as the mock
- [x] Tiles show the panel's icon, title and key in its tooltip (2026-10-17)

See what the agent is doing:

- [x] Tray icon with the change count; closing hides to the tray (+235 KiB)
- [x] Global shortcut to show/hide (`tauri-plugin-global-shortcut` on macOS/Windows, `sidekyk
      --toggle` on Linux; default `⌃⌥Space`, provisional; +160 KiB)
- [x] No git while hidden/minimized/covered; on show, read only what may have changed (watcher
      mark, or older than 30 s)
- [x] Window created hidden, shown after the first paint (fallback 3 s)
- [x] Recent commits in Changes (VS Code's graph, first parents, 50); a commit's files replace the
      list until `×`/`Esc`

Explore and copy:

- [x] Whole-file view ("Changes | Full file", default in settings): diff with full context, cut
      into git's three-line hunks; 20 ms on a 13,291-line file
- [x] Copy with a click in both views (line, hunk, selection) through the user's `{row}`/`{text}`
      template
- [x] Files panel (2026-10-17): tree of `git ls-files` (cached + others, minus deleted; 200,000
      max) kept in Rust, served per open folder (10,000 entries max); compact folders, VS Code
      order and change colors; collapse-all; read again only when a path is added/removed or the
      git dir changes (48 ms on Zed's clone, a folder 3 µs). In a tile the tree alone, Changes
      being the viewer; full screen tree + viewer. One shared selection (VS Code-style
      auto-reveal). Tree width dragged and stored (`filesTreeWidth`)
- [x] File view (`get_file_content`): files of the tree only, first 2 MiB, binary/link/submodule
      notices, links never followed; same rows and copy as diffs
- [x] Search by name in `⌘K` (2026-10-17): every file of the project on screen (the tree kept in
      Rust, plus deleted files), none at level 0; change marked by a word; `↵` goes through the
      shared selection. Scoring on threads from 20,000 paths (Zed's 4,366: 0.37 ms; 200,000
      synthetic: 80 → 14 ms)
- [x] Search in contents (`⌘F`, 2026-10-17): the palette's other mode (`⌘K`/`⌘F` switch, text
      kept), ripgrep's crates in-process over the tree's files through the port (no git), up to
      8 threads, first 2 MiB per file, stops at 2,000 lines, results streamed; the file shown
      first; a longer text reads only the files the last complete search found (43-50 ms on
      Zed's clone, ~5 MB). `↵` opens the file with a find bar at the line (`3/12`, `↵`/`⇧↵`,
      `Esc`)

## Next

- [ ] `⌘F` with a file open: the find bar directly, the palette for the project from there
- [ ] Rest of semantic zoom: splitters, panels minimized to the top bar (with Notes)
- [ ] Remaining mock icons from Tabler as features land (minimize, open in editor, …)

## Notes

- [ ] Notes panel: cards in lists, stored in the app data directory (spec in evolution, Notes)
- [ ] Optional Google Drive sync/backup (OAuth loopback + PKCE, tokens in the OS credential store,
      local first, conflicts keep both); nothing runs until an account is connected

## Beyond developers

- [ ] Projects as plain folders, git optional: Files and Notes, no Changes; file list and watcher
      filter without git (direction and open points in evolution, Beyond developers)
- [ ] Search inside documents (PDF, Office): text extraction, likely an index; decide with measures

## Then

- [ ] Level 0 cards with notes (changes in progress, waiting notes)
- [ ] Collect several hunks with a comment each, copy as one batch
- [ ] Scrollbar as a map of the changes (marks per hunk, click to go; narrow/wide setting)
- [ ] `n`/`p`: next/previous change, across files
- [ ] Syntax highlighting: lazy, rows on screen only, skipped above a size limit
- [ ] Side-by-side view; collapse unchanged regions with expand on demand
- [ ] Open a file in the editor at the hunk's line
- [ ] Diff context lines setting; Italian and English UI (as in Fyler); real app icon and tray
      glyph (today Tabler's `git-compare`); copy or reveal the log for bug reports

## Release

- [ ] CI with the `AGENTS.md` checks; Rust tests on macOS, Linux, Windows (end-to-end tests run a
      real git)
- [ ] Signed builds and self-update (as in Fyler); update check at startup or on demand only
- [ ] Linux watcher: one inotify watch per directory not ignored (~670 vs 33,000-47,000 for the
      ten repos in `~/Dev`; `clean-flow` alone 8,222 > old 8,192 limit); a failed watch must not
      fail the project
- [ ] To verify on the packaged app and other systems:
  - macOS: traffic lights position, pinch in WKWebView, tray glyph light/dark, `⌘W` hides and
    `⌘Q` quits, no blank frame at startup
  - Windows: global shortcut; watcher paths (`C:\…`) vs git's (`C:/…`) in the ignored filter and
    git-dir check, case included
  - Linux: `--toggle` from a desktop shortcut; tray with/without appindicator; which WebKitGTK
    runs View Transitions
  - Linux and Windows: tray icon and menu; a never-shown window's page loads and calls back;
    `visibilitychange` on minimize (WebView2 may need its controller told); `prefers-color-scheme`
    follows the window theme

## Performance review

Measure first; the first three give the numbers the rest are judged on.

- [ ] First paint and file switch timings as a script, also on the packaged app
- [ ] Budgets in `docs/performance.md` (cold start, show from hidden, file switch, snapshot and
      diff on reference repos, idle CPU/wakeups, memory, bundle and binary size); a commit over
      budget says why
- [ ] Reference repos for `backend_timings`: small, this one, Linux kernel scale, an unignored
      `node_modules`
- [ ] Idle footprint shown/hidden, quiet and during a burst (`powermetrics`, `footprint`)
- [ ] Hidden window: keep the WebView (instant show) or destroy it (memory)
- [ ] Tray count while hidden: watcher mark only, or a throttled `git status`
- [ ] Sustained churn: 250 ms batches mean 4 snapshots/s (200 writes in 3 s gave 14); minimum
      interval? skip `check-ignore` for tracked paths?
- [ ] The open file (Files) and the open diff are read again on every change on disk; restrict to
      changes that touch them
- [ ] Prefetch neighbouring diffs, if switching shows a wait; highlighting and fuzzy search off
      the main thread, if timings say so
- [ ] Bundle and binary size budgets in CI

## Out of scope

- Writing to git or to files (stage, commit, revert, edit): the agent, terminal or editor does it
- Running or embedding the agent
- Following the terminal's active tab (no signal holds across agents/terminals/tmux/OSes; see
  evolution)
- Replacing the `git` CLI with `gix`/libgit2 while process startup is not the measured bottleneck
