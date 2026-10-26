# Roadmap

What is left to build, by theme; not a timeline. **After:** marks an item that builds on another.
A built item leaves this file for `docs/features/` (`docs/README.md`). Every item keeps
repositories read-only and follows the golden rule (`AGENTS.md`); out of scope:
`docs/product.md`.

## App

- [ ] Real app icon and tray glyph (today Tabler's `git-compare`)
- [ ] Copy or reveal the log for bug reports

## Changes

`.cflow/plans/changes.md`.

- [ ] Linked worktrees: the branch in the top bar picks the one shown, read-only

## Notes

- [ ] Optional Google Drive sync/backup (`.cflow/plans/notes-sync.md`)
- [ ] Entities recognized while typing a note (`.cflow/plans/notes-entities.md`)
- [ ] Agents read a project's notes and captures over MCP, read-only (design open)

## Projects with optional folders

`.cflow/plans/project-folders.md`: a project is notes and zero or more folders, panels from what it
has.

- [ ] Layout without git: what takes Changes' tile (today Files; Notes leaning, decided with
      Capture)
- [ ] What changed without git: recently modified files, no diffs
- [ ] Several folders in a project (multi-root, e.g. api, web, ops): a root each in Files, a
      section per repository in Changes
- [ ] Search inside documents (PDF, Office): text extraction, likely an index; decide with measures

## Previews

`.cflow/plans/previews.md`.

Built: `docs/features/previews.md` (Markdown, SVG, images).

- [ ] A changed image's two sides next to each other, as VS Code
- [ ] PDF in the file viewer
- [ ] Mermaid diagrams in the Markdown preview (nice to have)

## Capture

`.cflow/plans/capture.md`.

- [ ] Images in notes: a note holds text and images (pasted, dropped), copied out with its text
- [ ] Annotate an image: arrows with their text, markers (A, B, C), editable later. **After:**
      images in notes
- [ ] Capture from a global shortcut: the system's tool picks the region, the image opens to
      annotate in a new note of the project on screen. **After:** annotate
- [ ] Quick capture of a note from a global shortcut with the window hidden (`docs/product.md`,
      tazly)

## Remote projects

Built: `docs/features/wsl.md`; what is left: `.cflow/plans/remote-projects.md`. The helper is
tried as a child process on the Mac and, built for Linux by `build.yml`, in the container fixture
(`docs/testing.md`).

- [ ] WSL projects tried on Windows 11 x64, from `build.yml`'s build
      (`.cflow/plans/remote-projects.md`, Open); later WSL1, ARM64
- [ ] `sidekyk .` from a WSL shell (`$WSL_DISTRO_NAME`). **After:** WSL projects
- [ ] Nice to have: remove the helper from a distro when its last project goes. **After:** WSL
      projects
- [ ] Container projects: the same helper through `docker exec -i` (a `LinuxMachine`, as the
      fixture's test); how the Mac ships it (arm64, amd64 under emulation). **After:** WSL projects

## Platforms and release

- [ ] Signed builds and self-update (as in Fyler), built by a release workflow on a `v*` tag that
      runs `ci.yml` first; update check at startup or on demand only
- [ ] Verify on the packaged app and other systems:
  - macOS: traffic lights position, pinch in WKWebView, tray glyph light/dark, a click on the tray
    icon shows the window, `⌘W` hides and `⌘Q` quits, no blank frame at startup; without the
    Command Line Tools, a folder without git picked asks nothing to install
  - Windows: global shortcut; watcher paths (`C:\…`) vs git's (`C:/…`) in the ignored filter and
    git-dir check, case included; a folder without git (`real_path` as given, its walk and
    rules, `git init` and `.git` removed while on screen); snapshot timings (process start, Defender); a repo on `C:\`
    edited from WSL (`/mnt/c`): events reach the watcher, Linux and Windows git on one index
    (stat data, filemode, autocrlf)
  - Linux and Windows: `navigator.languages` gives the system's language at the first start
    (WebKitGTK from `LANG`?, WebView2 from the display language?); the tray menu's text changes
    with the setting (`set_text`)
  - Linux: `--toggle` from a desktop shortcut; tray with/without appindicator; which WebKitGTK
    runs View Transitions
  - Linux and the WSL helper: the watcher one folder at a time (`folders watched` in the debug
    log; a new folder's files told, an ignored folder silent); a WSL folder without git through
    the real `wsl.exe` (its card without starting the distro, "Starting …" on opening it)
  - Linux and Windows: images in the viewer through `project-file:` (WebView2's
    `http://project-file.localhost`), a preview's link opened in the browser; WebKitGTK and AVIF
  - Linux and Windows: tray icon and menu; a never-shown window's page loads and calls back;
    `visibilitychange` on minimize (WebView2 may need its controller told); `prefers-color-scheme`
    follows the window theme

## Later

To evaluate once the app is complete, when its evolution is discussed.

- [ ] Notes as a folder of Markdown files in two-way sync (OpenTodo's vault, `docs/product.md`),
      outside repositories: an alternative to Drive sync

## Performance review

No measuring code in the app: a question below is measured with a temporary setup when it
becomes a problem (decided 2026-10-21).

- [ ] Hidden window: keep the WebView (instant show) or destroy it (memory)
- [ ] Sustained churn: 250 ms batches mean 4 snapshots/s (200 writes in 3 s gave 14); minimum
      interval? skip `check-ignore` for tracked paths? CodeNomad (2026-10-26): the first after
      100 ms, then at most one per 5 s while changes go on, no timer when idle
      (`ui/src/lib/filesystem-events.ts`); 5 s is too stale to watch an agent, the shape fits
      (first at once, last always, N measured)
- [ ] Snapshot: with nothing staged, numstat `HEAD` repeats numstat unstaged, ~30% of its git CPU
      (`.local/format-cost/`, 2026-10-26)
- [ ] Prefetch neighbouring diffs, if switching shows a wait
