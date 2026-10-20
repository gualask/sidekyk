# Roadmap

What is left to build, by theme; not a timeline. **After:** marks an item that builds on another.
A built item leaves this file for `docs/features/` (`docs/README.md`). Every item keeps
repositories read-only and follows the golden rule (`AGENTS.md`); out of scope:
`docs/product.md`.

## Try in the app

- [ ] Syntax colors in the running app (`pnpm tauri:dev`; `docs/features/syntax-colors.md`)
- [ ] Languages in the running app: the first start's language, the tray menu and tooltip as the
      setting changes, dialog titles, an export (`docs/features/languages.md`)

## App

- [ ] Real app icon and tray glyph (today Tabler's `git-compare`)
- [ ] Copy or reveal the log for bug reports

## Notes

- [ ] Optional Google Drive sync/backup (`docs/plans/notes-sync.md`)

## Folders without git

`docs/plans/folders-without-git.md`.

- [ ] Projects as plain folders, git optional: Files and Notes, no Changes; file list behind a
      port; watcher filter without git
- [ ] Search inside documents (PDF, Office): text extraction, likely an index; decide with measures

## Remote projects

`docs/plans/remote-projects.md`; the helper tried as a child process on the Mac and, built for
Linux by `build.yml`, in the container fixture (`docs/testing.md`).

- [ ] WSL projects tried on Windows 11 x64, from `build.yml`'s build
      (`docs/plans/remote-projects.md`, Open); later WSL1, ARM64
- [ ] `sidekyk .` from a WSL shell (`$WSL_DISTRO_NAME`). **After:** WSL projects
- [ ] Nice to have: remove the helper from a distro when its last project goes. **After:** WSL
      projects
- [ ] Palette: two projects of one name (a local and a WSL clone of `shop`) look alike; name the
      distro there too? Ask with a preview first
- [ ] Container projects: the same helper through `docker exec -i` (a `LinuxMachine`, as the
      fixture's test); how the Mac ships it (arm64, amd64 under emulation). **After:** WSL projects

## Platforms and release

- [ ] Signed builds and self-update (as in Fyler), built by a release workflow on a `v*` tag that
      runs `ci.yml` first; update check at startup or on demand only
- [ ] Linux watcher: one inotify watch per directory not ignored (~670 vs 33,000-47,000 for the
      ten repos in `~/Dev`; `clean-flow` alone 8,222 > old 8,192 limit); a failed watch must not
      fail the project
- [ ] Verify on the packaged app and other systems:
  - macOS: traffic lights position, pinch in WKWebView, tray glyph light/dark, `⌘W` hides and
    `⌘Q` quits, no blank frame at startup
  - Windows: global shortcut; watcher paths (`C:\…`) vs git's (`C:/…`) in the ignored filter and
    git-dir check, case included; snapshot timings (process start, Defender); a repo on `C:\`
    edited from WSL (`/mnt/c`): events reach the watcher, Linux and Windows git on one index
    (stat data, filemode, autocrlf)
  - Linux and Windows: `navigator.languages` gives the system's language at the first start
    (WebKitGTK from `LANG`?, WebView2 from the display language?); the tray menu's text changes
    with the setting (`set_text`)
  - Linux: `--toggle` from a desktop shortcut; tray with/without appindicator; which WebKitGTK
    runs View Transitions
  - Linux and Windows: tray icon and menu; a never-shown window's page loads and calls back;
    `visibilitychange` on minimize (WebView2 may need its controller told); `prefers-color-scheme`
    follows the window theme

## Performance review

Measure first: the first three give the numbers the rest are judged on (**After:** them).

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
- [ ] Prefetch neighbouring diffs, if switching shows a wait
- [ ] Bundle and binary size budgets in CI
- [ ] A sidebar drag stores every setting through `set_settings` (theme applied again, file
      written, shortcut status read again): a lighter path for layout-only settings?
