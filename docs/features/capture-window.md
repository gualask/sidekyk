# Capture window

The step after an area is captured (`capture.md`): the crops of a note, their marks
(`note-images.md`), its text and where it goes, written in one step on `↵`. macOS, where capture
is built.

## Behaviour

- What a capture is for, most frequent first: a bug for the agent, now; a reminder to sort later;
  material for a note already there.
- Where the note starts going, by entry:
  - the global shortcut and the tray's Capture: the place (project and list) last chosen for a
    capture this session; before any, the project last on screen on the list it opens on; none,
    the Inbox;
  - the icon of a Notes field (the Inbox's too): that list;
  - "Add capture" in a note's ⋯, the icon after the images of a card being edited: that note,
    fixed, its images and text in the window.
- Sidekyk's window becomes the capture window over the app in front, centered on the display
  the area was taken on (the pointer may have left it before `↵`), fitted to the crop within
  about 70% of the display, at least 560x400 pt; over a native full screen app, a box in the middle of Sidekyk's
  Space, as the quick note (`quick-note.md`). Top to bottom: the image selected with its marks;
  the strip of the draft's images (from two on) and the + tile; the text; where it goes (Move's
  field, as the quick note's, or "Adding to “…”" for a note) and the keys.
- More crops: `⌃⌥C`, the tray or the + while the window is open starts the overlay over it; the
  crop joins the draft, selected; `Esc` in the overlay goes back to the draft. A crop shows a ×
  on hover that takes it out, but a new note's only one; a note's own images stay, and can be
  marked anew.
- Keys: the window opens with the focus on the image. There, the marks' keys (`note-images.md`),
  `↵` with no mark selected writes the note, `←` `→` change image. In the text, `↵` writes it,
  `⇧↵` breaks the line. `⌘↵` anywhere writes it and copies it for the agent (as a note's copy).
  `Tab` goes image, text, destination; `⇧Tab` back; the destination as in the quick note.
- `↵`: the marks drawn, the note written in one step, on top of the destination's list (a list
  to make is made first), or the note added to; the window goes back as it was, the app in front
  getting the focus back. The place chosen becomes the session's last one (not a note's). A
  failure keeps the window and the draft, with a toast.
- `Esc`, or `⌘W`: the draft goes, asked first when it has marks or text; a note added to stays as
  it was. A click outside leaves the window open: the + takes the focus to the overlay.
- While the window is open: the window's shortcut, the Dock and the tray's Show leave it open, in
  front; the quick note's shortcut does nothing. `⌃⌥C` while the quick note is open closes it
  (its draft kept) and starts the capture.

## How it is built

- The compact window's capture view (`quick-note.md`, How it is built): `desktop/compact_window.rs`
  opens it on `taken`, its frame from `compact_frame::capture_frame`, the layout kept mounted
  under it; the page tells it painted, as the quick note's.
- Crops reach the webview at `capture-image://localhost/<crop>.png` (and
  `.thumb.png`), `note-image` serving only a book's images; `crop_png` gives one to draw marks
  over.
- `write_capture`: the note as a line of JSON, then each marked image's PNG back to back, their
  lengths in the JSON; `NotesStore::write_capture` writes the crops, the PNGs, the images marked
  anew and the text in one change, files first, so a failure leaves the book as it was. The crops
  go only once written.
- Frontend: the draft lives in the page (`model/capture-draft.ts`, pure: where it starts, the
  images, the letters across them, what `↵` does, what is written), held apart from any view
  (`application/captures.ts`, with the session's last place: only the page knows the project on
  screen, and a hidden page still gets the event). `ui/capture-window/`, the marks' stage shared
  with the viewer's Annotate (`MarkStage`).

## Decisions

- A compact window, not the full layout (the maintainer): the main window's WebView, as the quick
  note, over the app the capture was of. One owner for the window's views
  (`desktop/compact_window.rs`): one `NSWindow` and one frame to go back to.
- Nothing written before `↵`, the draft not kept for the session: a capture is a short task, and
  the crops of one bug go into one note, marked together.
- Where it starts: the last place chosen this session, else the project last on screen, hidden
  or not (an agent's bug captured in the browser belongs to its project), else the Inbox. Not
  guessed from the app in front. Unlike the quick note (the Inbox): a capture's dominant use is
  a bug for the project at hand.
- Where an entry's capture goes travels with the capture in the backend: a cancel tells the page
  nothing, so a place held there would land on the next capture.
