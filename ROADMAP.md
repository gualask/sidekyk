# Roadmap

What is left to build, by theme; not a timeline. **After:** marks an item that builds on another.
A built item leaves this file for `docs/features/` (`docs/README.md`). Every item keeps
repositories read-only and follows the golden rule (`AGENTS.md`); out of scope:
`docs/product.md`.

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
  - Linux and the WSL helper: the watcher one folder at a time (`folders watched` in the debug
    log; a new folder's files told, an ignored folder silent)
  - Linux and Windows: tray icon and menu; a never-shown window's page loads and calls back;
    `visibilitychange` on minimize (WebView2 may need its controller told); `prefers-color-scheme`
    follows the window theme

## Performance review

No measuring code in the app: a question below is measured with a temporary setup when it
becomes a problem (decided 2026-10-21).

- [ ] Hidden window: keep the WebView (instant show) or destroy it (memory)
- [ ] Tray count while hidden: watcher mark only, or a throttled `git status`
- [ ] Sustained churn: 250 ms batches mean 4 snapshots/s (200 writes in 3 s gave 14); minimum
      interval? skip `check-ignore` for tracked paths?
- [ ] Prefetch neighbouring diffs, if switching shows a wait
