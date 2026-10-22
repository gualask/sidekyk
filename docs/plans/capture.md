# Plan: capture

Show something on screen to a colleague or an agent: a region captured, an arrow pointing at an
element with a word on it, or a marker ("A") the message then names ("at A there is a problem").
High level, agreed 2026-10-22; details when it is built.

## Design

- Notes are a workspace of text and images: a note may hold images beside its text. Still a list
  of cards, not a free canvas (Figma-like placement is too much).
- Images enter a note pasted or dropped (a capture made with the system's tool works from day
  one), or from Capture.
- Annotate an image: arrows carrying their text, markers A, B, C… placed in order; the objects
  stay editable later (original and objects kept apart, as Shotoshot's `.shoto`).
- Capture: a global shortcut starts the system's tool, which picks the region (macOS
  `screencapture -i`, Windows Snipping Tool, Linux the screenshot portal; each to verify); the
  image opens to annotate in Sidekyk's window, in a new note of the project on screen, text field
  ready. No overlay of our own over a frozen screen: pixels, per-monitor windows and Wayland
  differ by OS, and macOS asks for Screen Recording; it can come later over the same annotations.
- Stored with the notes, in the app data directory, never in a repository.

## Open

- A capture as a note of its own, or added to a note (both, the shortcut making a new one?).
- Copy out for an agent and for a colleague: the image (flattened) and the text, the image's path
  in the text (WSL projects need it translated), or the copy template (`../features/notes.md`).
- Which annotations besides arrows with text and markers (rectangle, highlight).
- With images, Notes may take Changes' tile in a project without git
  (`project-folders.md`).
- Where a global capture lands: the Inbox while the window is hidden, the project on screen while
  shown? To try (`project-folders.md`).
- Images and notes sync (`notes-sync.md`): size.

## References

- Shotoshot (GPL-3.0, Windows and Linux, Rust, no webview; ideas only): one editor process per
  capture, memory back to the system when it ends; Linux pixels from the portal, non-interactive,
  or X11 directly; `.shoto` a PNG with a private chunk holding the frame and the objects; a
  confirmation banner that takes no focus.
- Carbon (`../product.md`): images pasted or dropped into notes; a small window confirming a
  capture while the main one is hidden.
