# Capture

An area of the screen captured from any app becomes a new note, its marks open at once
(`note-images.md`). Built on macOS (14 at least); Windows and Linux next (`../../ROADMAP.md`).

## Behaviour

- Entries: the global shortcut "Capture an area of the screen" (Settings, default `⌃⌥C`,
  provisional), the tray's Capture, an icon at the right of the Notes field (the Inbox's too).
  A capture already on: the shortcut does nothing. An image's marks open: the shortcut and the
  tray only show the window, since the capture's marks would open in their place.
- The display under the pointer, read at its pixels without Sidekyk's windows, shows frozen and
  dimmed over everything, full screen apps and every Space included. A drag draws the area: it
  shows bright, with a 1 px white border, 8 handles and, below its right edge (above it near the
  bottom), the pixels it crops and the Capture button (the app's accent, `↵` on it).
- Then it stays: a drag inside moves it (whole on the display); an edge or a corner resizes it,
  turning over past the opposite one (6 pt out, in at most a quarter of the side, so a small
  area keeps a middle that moves it); a drag outside draws another in its place; a drag that
  leaves under 4 pt a side, a click, keeps it as it was. `↵`, a double click in it or the
  button captures; `Esc` cancels and tells nothing. The pointer shows what a press does
  (crosshair, hand, macOS 15's resize cursors; the crosshair on handles on 14). No window
  snapping, no arrow keys.
- The area captured comes back at the next capture on the same display, while Sidekyk runs, so
  the same spot again is `⌃⌥C` then `↵`; it starts empty when it no longer fits the display.
- Only the crop is kept, as PNG (RGB, a screen being opaque); the frozen frame is dropped. Not
  held to the 25 MiB a pasted image is: a 5K photo-like screen may pass it.
- Then Sidekyk shows: the crop is a new note on top of the open list of the project last on
  screen, hidden or not, or of the Inbox when none was open. Its marks open, the editor naming
  where it went ("In shop"). Done keeps it, marked or not, and opens the note for its text;
  Cancel or `Esc` discards the capture: the note goes, with Undo (the maintainer).
- Without the Screen Recording permission, nothing freezes: macOS asks once, and the app's toast
  says capture needs it, with "Open Settings" (Privacy & Security › Screen Recording). macOS
  adds Sidekyk to that list by itself. A failure is a toast too.
- macOS asks again, monthly since Sequoia, to let Sidekyk "bypass the system private window
  picker": any capture outside the system's picker (a window or a display, no region) does.

## How it is built

- Core `modules/capture/`: the area and how a drag changes it (`Selection`: what a press does
  where, draw, move, resize, a click undone, a remembered area that fits), its pixels at the
  display's scale, its label and where it goes; the event (`capture`: `taken`, `refused`,
  `failed`). Tested; each system's overlay only forwards the pointer and draws. The crop's
  pixels become the note's image in `notes::prepare_capture`: PNG and thumbnail encoded once,
  never decoded again.
- macOS, `infrastructure/capture/macos.rs`: ScreenCaptureKit (`SCShareableContent`, a filter of
  the display without our process, `SCScreenshotManager`); a non-activating `NSPanel` at the
  screen saver level (`CanJoinAllSpaces`, `FullScreenAuxiliary`), its view hosting CoreAnimation
  layers: the frame dimmed (0.35), the same `CGImage` bright through the area's `contentsRect`,
  the border, the handles, a `CATextLayer` label and button; an `NSTrackingArea` for the
  pointer's shape. Nothing redrawn but those layers. The crop is drawn into an sRGB RGBA bitmap
  and encoded off the main thread. The area last taken, given at the start, shows picked on its
  display.
- `infrastructure/capture/`: whether capture is built here (`CAPTURE_BUILT`, which the frontend
  reads through `can_capture`), the system's settings for the permission, `start` on every system
  (elsewhere it ends at once, never reached).
- `desktop/capture.rs`: one capture at a time, from its start until its outcome, another
  start ignored; the area last taken, by display, for the session. Each crop waits in a queue
  until the frontend, told `taken`,
  names the book (`add_capture`; `NotesStore::add_capture`: a new note on top of its open list),
  so two captures in a row each find their own. `set_marking`
  holds captures while marks are edited; a page loaded again resets it. The button's text is
  read without the settings' lock (`texts::current`), on the main thread a settings change may
  wait on.
- Frontend: the capture's marks wait for its card (`useCaptureMarks`) and open once, apart from
  the panel's target, which comes back each time the panel shows.
- Global shortcuts (`background.md`): the window's and capture's, each its own keys, switch,
  status and problem; one may not take the other's keys (`shortcut_in_use`; at startup the
  second is `inUse`, a problem). A change failing on one shortcut puts the other back. The
  plugin's id of capture's tells a press apart, read without the lock a change holds.

## Measures

- From the trigger to the frozen screen on glass (2940x1912, `.local/capture-overlay/`): a
  native window 63-84 ms (first 155) and ~10 MB; a WebView made on the spot 250-320 ms (first
  435-740) and ~200-300 MB over WebKit's processes while shown; a WebView kept ready 160-250 ms
  and ~90 MB held while idle. ScreenCaptureKit reads the display in 30-50 ms.

## Decisions

- Our own overlay, native per system (the maintainer: one UX on every system, felt
  native, no system shortcut to remember; KISS, more on felt need). Not the system's tool: each
  differs, Windows' new protocol answers packaged (MSIX) apps only and none yet, the old one is
  deprecated and leaves the snip on the clipboard, KDE's portal has no region, GNOME's
  non-interactive one flashes and leaves a file. Not a WebView: 3-4x slower and 20-30x the
  memory (Measures).
- Not a crate that reads every system: one on macOS reads through an API the macOS 15 SDK
  obsoletes, and pulls dozens of crates on Linux. One direct path per system; only
  `objc2-screen-capture-kit` is new, the rest is in the tree through Tauri.
- macOS 14 at least (`bundle.macOS.minimumSystemVersion`): `SCScreenshotManager`.
- A capture always makes a new note; paste and drop add to one.
- It lands in the project last on screen, hidden or not: an agent's bug captured
  in the browser belongs to its project.
- The capture shortcut on by default, as the window's.
- An area adjusted, then confirmed, and remembered (the maintainer), not captured on release:
  one step more per capture, but a precise area, and the same spot again, as an agent fixes what
  was captured, is one key. Remembered for the session only, until a
  need for more.
- Sidekyk always left out of the frame (the maintainer): a capture is nearly always
  of something else, and started from Sidekyk its window would cover it. Sidekyk's own UI: the
  system's screenshot to the clipboard (`⌃⇧⌘4`) pasted into a note. No setting for it.
- No Move in the marks editor (KISS): it names where the note went, and after Done
  the note is open with Move… in its ⋯; a move meanwhile would leave the editor saving to the
  old place.
