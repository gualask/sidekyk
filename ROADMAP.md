# Roadmap

What is left to build, by theme; not a timeline. **After:** marks an item that builds on another;
**Next:** the one to build next, nothing left to decide.
A built item leaves this file for `docs/features/` (`docs/README.md`). Every item keeps
repositories read-only and follows the golden rule (`AGENTS.md`); out of scope:
`docs/product.md`.

## App

- [ ] Waiting for notify 9 stable (9.0.0-rc.7 on 2026-10-31), with its `notify-debouncer-mini`
      (0.8): installed as soon as it is out, before anything else; on Windows the system's
      dropped events become a rescan (notify-rs#964; `docs/architecture.md`, Watching)
- [ ] Real app icon and tray glyph (today Tabler's `git-compare`)

## Notes

- [ ] Optional Google Drive sync/backup (`.cflow/plans/notes-sync.md`)
- [ ] Entities recognized while typing a note (`.cflow/plans/notes-entities.md`)
- [ ] Agents read a project's notes and captures over MCP, read-only (design open;
      `.cflow/plans/agents-mcp.md`)

## Projects with optional folders

`.cflow/plans/project-folders.md`: a project is notes and zero or more folders, panels from what it
has. Built: `docs/features/project-folders.md` (several folders, one on screen).

- [ ] Search inside documents (PDF, Office): text extraction, likely an index; decide with measures
      (`.cflow/plans/project-folders.md`)

## Previews

`.cflow/plans/previews.md`.

Built: `docs/features/previews.md` (Markdown, SVG, images, a changed image's two sides).

- [ ] Mermaid diagrams in the Markdown preview (nice to have)

## Capture

`.cflow/plans/capture.md`.

Built: `docs/features/note-images.md` (images in notes, marks), `docs/features/capture.md`
(capture on macOS).

- [ ] Capture on Windows: Windows.Graphics.Capture (GDI as fallback) and a Win32 overlay, tried
      on a machine
- [ ] Capture on Linux: X11 and wlroots with the overlay, `sidekyk --capture` from the
      desktop's shortcut; GNOME and KDE after trying ScreenCast's one frame
- [ ] Quick capture of a note from a global shortcut with the window hidden (`docs/product.md`)

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

- [ ] Signed builds and self-update (as in Fyler; `.cflow/plans/release.md`), built by a release
      workflow on a `v*` tag that runs `ci.yml` first; update check at startup or on demand only.
      macOS: one universal `.dmg` (`--target universal-apple-darwin`; 2026-10-29: Intel Macs too,
      which stop at macOS 26, at no runtime cost, since only the native slice loads)
- [ ] Verify on the packaged app and other systems:
  - macOS, capture (`docs/features/capture.md`): over a full screen app and on another Space,
    two displays (the one under the pointer), the monthly "bypass the system private window
    picker" prompt, the permission kept across an update of a signed build
  - macOS: traffic lights position, pinch in WKWebView, tray glyph light/dark, a click on the tray
    icon shows the window, `⌘W` hides and `⌘Q` quits, hidden while full screen (closed or by
    the shortcut) no black Space left, no blank frame at startup; without the Command Line
    Tools, a folder without git picked asks nothing to install
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
  - Linux and Windows, images in notes (`docs/features/note-images.md`): a screenshot and a file
    copied in the file manager pasted (a `File` with its bytes?); a file drop's position on the
    right card (physical pixels over `devicePixelRatio`); a note's copy written after the backend
    answers; "Copy image" (`ClipboardItem`, WebKitGTK?); a WSL note's copy gives `/mnt/c/…` paths
  - Linux and Windows, marks on images: how long Done takes on a 5K screenshot (WebView2 encodes
    `toBlob` in idle time; `.local/note-thumbnails/`, `mode=flatten`), the labels in the app's
    font, a label's field over its label
  - Linux and Windows: tray icon and menu; a never-shown window's page loads and calls back;
    the window's visibility (`docs/testing.md`, Trying it on Windows and Linux; WebView2 may
    need its controller told); `prefers-color-scheme` follows the window theme

## Later

To evaluate once the app is complete, when its evolution is discussed.

- [ ] Notes as a folder of Markdown files in two-way sync, outside repositories: an alternative
      to Drive sync (`.cflow/plans/notes-sync.md`)
- [ ] PDF in the file viewer, decided with projects without git, where documents live: VS Code
      and Zed have none, and in a repository an agent edits a PDF rarely changes. Candidate:
      `pdfium-render` rendering in Rust (2026-11-01; `.cflow/plans/previews.md`, PDF)

## Performance review

No measuring code in the app: a question below is measured with a temporary setup when it
becomes a problem (decided 2026-10-21).

- [ ] Hidden window: keep the WebView (instant show) or destroy it (memory)
- [ ] Prefetch neighbouring diffs, if switching shows a wait
