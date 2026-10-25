# Background

Sidekyk lives in the background while the agent works: tray, global shortcut, no work while
hidden.

## Behaviour

- Tray (2026-10-24): it tells the app runs, nothing about projects. A click shows the window on
  macOS and Windows, the right button opens the menu (Show, Quit, in the UI's language); on Linux
  every click opens the menu (appindicator reports no clicks). Closing the window hides it to the
  tray.
- Global shortcut: shows the window when hidden, minimized or behind, hides it in front (on macOS
  the whole app). Default `⌃⌥Space`, provisional. On Linux the desktop's shortcut runs `sidekyk
  --toggle`.
- Hidden, minimized or covered: no git; on show only what may have changed is read
  (`projects.md`).
- The window is created hidden and shown after the first paint.

## How it is built

- Tray: macOS template glyph (`icons/tray-template.png`); on Linux without appindicator its panic
  is caught and closing quits. +235 KiB on the binary.
- Visibility: the page reports `visibilitychange` (`set_window_visible`; WKWebView follows
  occlusion). While hidden a watcher batch only marks the project; showing returns it, and the
  frontend reads it and anything on screen older than 30 s.
- First show: `show_window` once the project list is read; the backend shows it after 3 s anyway.
- Global shortcut: `tauri-plugin-global-shortcut` on macOS and Windows (+160 KiB). A modifier plus
  a letter, digit or named key, or F1-F20 alone; no punctuation (codes name US keys); checked in
  the backend. A refused one keeps the previous and shows a problem; macOS accepts duplicates
  silently, so its own shortcuts are read (`CopySymbolicHotKeys`,
  `infrastructure/system_shortcuts.rs`) to warn. `⌥`-only shortcuts work on macOS 27.

## Decisions

- Global shortcut (2026-10-15): `global-hotkey` (Carbon `RegisterEventHotKey`, `RegisterHotKey`),
  idle until pressed, no permission. Not `handy-keys` (sees every key, Accessibility permission)
  nor `livesplit-hotkey`. Its X11 backend wakes every 50 ms and Wayland has none, hence `--toggle`
  on Linux (single instance).
- A plain tray (2026-10-24): no change count, no dot for hidden changes (always on while an agent
  works, 2026-10-14).
- Open: the default shortcut (`⌃⌥Space` is "next input source" with two input sources; `⌥Space` is
  Raycast's and Alfred's).
