# Background

Sidekyk lives in the background while the agent works: tray, global shortcut, no work while
hidden.

## Behaviour

- Tray icon: it tells the app runs while hidden, nothing about projects. A click shows the window
  on macOS and Windows, the right button opens the menu (show, quit, in the UI's language,
  `languages.md`); on Linux every click opens the menu (appindicator reports no clicks). Closing
  the window hides it to the tray.
- Global shortcut shows the window when hidden/minimized/behind, hides it in front (on macOS the
  whole app). Default `⌃⌥Space`, provisional. On Linux the desktop's shortcut runs
  `sidekyk --toggle`.
- Hidden, minimized or covered: no git. On show, only what may have changed is read: the watched
  project if marked while hidden, anything older than 30 s (`projects.md`).
- The window is created hidden and shown after the first paint.

## How it is built

- Tray: reads nothing of the projects; macOS template glyph (`icons/tray-template.png`). Closing
  hides the window while the tray exists; on Linux without appindicator the tray panic is caught
  and closing quits. +235 KiB on the binary with its menu.
- Visibility: the watcher's batch is dropped while hidden and the project only marked. WKWebView
  follows occlusion; the page reports `visibilitychange` (`set_window_visible`); showing again
  returns the marked project, and the frontend reads it plus anything on screen older than 30 s.
- First show: `show_window` once the project list is read (first call only); backend fallback
  after 3 s.
- Global shortcut: `tauri-plugin-global-shortcut` on macOS/Windows (+160 KiB). Combination: a
  modifier (`⌘`/`Win`, `Ctrl`, `⌥`/`Alt`) plus letter, digit or named key, or F1-F20 alone; no
  punctuation (codes name US keys). Checked in the backend. Refused ones keep the previous and show
  a problem; macOS accepts duplicates silently, so its own shortcuts are read
  (`CopySymbolicHotKeys`, `infrastructure/system_shortcuts.rs`) to warn. `⌥`-only shortcuts work
  on macOS 27.

## Decisions

- Global shortcut (2026-10-15): `global-hotkey` (Carbon `RegisterEventHotKey`, `RegisterHotKey`),
  idle until pressed, no permission. Rejected: `handy-keys` (sees every key, Accessibility
  permission), `livesplit-hotkey`. On Linux its X11 backend wakes every 50 ms and Wayland has none,
  hence `--toggle` (single instance).
- No dot on the tray icon for hidden changes (2026-10-14, `../product.md`).
- Plain tray, no change count (2026-10-24): it only tells the app runs and brings it back.
- Open: the default shortcut (`⌃⌥Space` is taken by "next input source" with two input sources;
  `⌥Space` is Raycast's and Alfred's).
