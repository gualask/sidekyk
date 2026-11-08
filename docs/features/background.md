# Background

Sidekyk lives in the background while the agent works: tray, global shortcut, no work while
hidden.

## Behaviour

- Tray: it tells the app runs, nothing about projects. A click shows the window on
  macOS and Windows, the right button opens the menu (Show, Capture and New Note where they are
  built, Quit, in the UI's language; `capture.md`, `quick-note.md`); on Linux every click opens the menu (appindicator reports no
  clicks). Closing the window hides it to the tray.
- Global shortcut: shows the window when hidden, minimized or behind, hides it in front (on macOS
  the whole app). Default `⌃⌥Space`, provisional. On Linux the desktop's shortcut runs `sidekyk
  --toggle`. Where they are built, a second captures an area of the screen (`capture.md`) and a
  third opens a quick note (`quick-note.md`): each has its own row in Settings, keys, switch and
  problem; none may take another's keys (a problem names the one holding them). While a new one
  is typed, none acts.
- Hidden, minimized or covered: no git; on show only what may have changed is read
  (`overview.md`).
- The window is created hidden and shown after the first paint.

## How it is built

- App icon: one source, `icons/source/icon.svg`: the mark (two spiral arms making an S, full
  strokes with no thin trails, so it holds at 16 px) on macOS's body, an opaque superellipse of
  824 px on the 1024 grid. `pnpm tauri icon src-tauri/icons/source/icon.svg` makes every
  platform's files; its `android/` and `ios/` folders are not kept. macOS 26 and later show it
  whole, unlike a bare mark, which they put in a grey tile (checked on macOS 27.2 with
  `NSWorkspace`'s icon of a test bundle). No Liquid Glass `.icon` yet (`ROADMAP.md`).
  `generate_context!` and `include_image!` read the files at compile time and Cargo does not
  track them: after new icons, touch `bootstrap/mod.rs` and `interfaces/tauri/tray.rs`.
- Tray: on macOS a template glyph, `icons/tray-template.png`: 18 pt drawn at 36 px, the mark's
  two arms thickened, from `icons/source/tray.svg` (`pnpm tauri icon … -p 36 -o <dir>`, its
  `36x36.png`); elsewhere the app icon in color. On Linux without appindicator its panic is
  caught and closing quits. +235 KiB on the binary.
- Visibility: the page reports `visibilitychange` (`set_window_visible`; WKWebView follows
  occlusion). While hidden a watcher batch only marks the project; showing returns it, and the
  frontend reads it and anything on screen older than 30 s.
- First show: `show_window` once the project list is read; the backend shows it after 3 s anyway.
- Global shortcut: `tauri-plugin-global-shortcut` on macOS and Windows (+160 KiB). A modifier plus
  a letter, digit or named key, or F1-F20 alone; no punctuation (codes name US keys); checked in
  the backend. A refused one keeps the previous and shows a problem; a press tells the two apart
  by the plugin's id of capture's, read without the lock a change holds. macOS accepts duplicates
  silently, so its own shortcuts are read (`CopySymbolicHotKeys`,
  `infrastructure/system_shortcuts.rs`) to warn. `⌥`-only shortcuts work on macOS 27.

## Decisions

- Global shortcut: `global-hotkey` (Carbon `RegisterEventHotKey`, `RegisterHotKey`),
  idle until pressed, no permission. Not `handy-keys` (sees every key, Accessibility permission)
  nor `livesplit-hotkey`. Its X11 backend wakes every 50 ms and Wayland has none, hence `--toggle`
  on Linux (single instance).
- A plain tray: no change count, no dot for hidden changes (always on while an agent
  works).
- Open: the default shortcut (`⌃⌥Space` is "next input source" with two input sources; `⌥Space` is
  Raycast's and Alfred's).
