# Images in notes

A note holds text and, below it, images: pasted or dropped, shown as thumbnails, copied out as
paths for an agent, marked with letters and arrows. The notes themselves:
`notes.md`. What comes next on images (capture): `../../.cflow/plans/capture.md`.

## Behaviour

- Below the text, thumbnails 72 px high, as wide as the image's shape gives (40-200 px, cropped to
  the middle beyond), in the order they came in. A note may be images alone: its text reads
  "Add text…" and closing it empty keeps it; without images an empty note still goes (Undo).
- In: an image pasted or dropped into the empty field on top adds a note at once, opened to write
  its text (Capture will reuse this). With text in the field, it waits below it (previews when
  pasted, names when dropped, × leaves one out) until `↵`; images that fail to be added wait there
  too, the text's note made. Dropped on a card, it joins that note.
  Several files dropped at once: one note. The Inbox takes images too.
- Formats: PNG, JPEG, GIF, WebP, told by their bytes, never by a name; others (and folders) are
  refused with a toast (`image_unsupported`). At most 25 MiB and 64 Mi pixels (`image_too_large`).
  Bytes kept as given.
- A click on a thumbnail opens the image large over the app, never scaled up: size and weight, `←`
  `→` through the note's images, "Copy image" (PNG), `Esc` or a click outside closes. On hover a
  × takes an image out, with Undo.
- Marks: "Annotate" in the viewer shows the image as given with its marks, editable. One object,
  a label (a letter or a text) with an optional tail ending in an arrowhead; a tail without text
  is a plain arrow. A click places the next letter, a drag from a spot places it at the release
  with its tail pointing back; a mark drags; the selected one's handle (its tail's tip, or the
  label's right side) moves the tip, dropped on the label the tail goes; a double click or `↵`
  writes its text; `⌫` takes it out; `⌘Z`/`⇧⌘Z` (`Ctrl+Z`/`Ctrl+Y`). Done keeps them: the
  marked image takes the original's place in the note, thumbnail, copy, "Copy image" and export
  included; no marks left gives the original back. Cancel or `Esc` leaves without keeping what
  the session changed, as `Esc` cancels everywhere in the app; with changes, it asks first.
- A label stays whole inside the image, moved in from an edge, so the PNG never cuts it; at most
  100 marks of 200 characters, the backend's limits.
- A letter placed never changes: the next is the one after the highest (B deleted, D after C),
  since the message names them; past Z, the first free one.
- Copy: the note's text, then each image's absolute path on a line of its own, so an agent reads
  the file (Claude Code and Codex read it pasted bare, `Application Support`'s space included,
  outside their folder; 2026-11-01). A WSL project's note gives the paths as its distro names
  them. Without images, the text as it is.
- Export: a project with images exports a folder, named in the dialog: the Markdown file named
  after it, the images in `images/`, linked below their note's text (`![](images/<file>)`).

## How it is built

- Files beside the notes, in the book's folder (`notes.md`, Storage): `<image>.<ext>` as given,
  `<image>.thumb.png` its thumbnail; the note's JSON holds only `images: [{ id, kind, width,
  height, bytes }]` (none before images, `serde(default)`), so the books in memory hold no pixels.
  Ids are 16 hex digits, as notes'.
- `modules/notes/images.rs` (core, `image` crate): the kind from the bytes, a decode bounded by
  `Limits` (the declared size checked before any pixel), the orientation the file states applied,
  a thumbnail of 480 px on its longest side (Triangle), 8 bits, alpha kept, PNG. Runs in the
  command's blocking thread, outside the store's lock; the store then writes the files, then the
  note.
- A note leaving a book (deleted, an image taken out, moved) leaves its files: the first read of
  the book in the next session removes those no note names (`swept`, once a session, so an undo
  finds them), unless a note of the book could not be read. A move writes copies into the taking
  book before the note (`carry_images`, inside `exchange`).
- In: a paste gives the webview a `File` (WKWebView: a screenshot's data and a file copied in
  Finder alike, `.local/note-paste/`); its bytes cross raw (`add_note_image`, book and target in
  headers). A drop never reaches the webview: Tauri's handler takes every file drop on the three
  systems (wry 0.57.1), so `onDragDropEvent` gives paths and a position; the column under it
  (`elementFromPoint`, `data-image-drop`) picks the card or the field, and the backend reads the
  files (`add_note_image_files`, `given_images`: a regular file within the limit, all or none, read
  through the `GivenFiles` port).
- Out: `note-image://localhost/<book>/<file>` (`http://note-image.localhost/…` on Windows), the
  book and the file encoded as `project-file:`'s (`previews.md`); only a file a note of the book
  names, `immutable` (an id names its bytes). CSP `img-src` lists it. `Notes::copy` composes the
  copy; each image's path as the project's machine names it (`Machine::host_path`; for WSL,
  `wslpath -u` of its folder, run by the distro's helper, once per distro, folder and session:
  a `wsl.exe` measured 384 ms on Windows, a request to the running helper starts none).
  `note_image_png` gives a non-PNG image as PNG for the clipboard (`ClipboardItem`).
- Marked image: a PNG drawn in the webview (`draw-marks.ts`, the editor's own drawing code at
  the image's size, the app's font loaded first) over the original as PNG (`note_image_png`),
  sent with the marks (`mark_note_image`: a line of JSON, then the PNG raw). The backend checks
  it (a PNG as large as the original, marks inside it, within the limits), gives it a
  new id and a thumbnail, and keeps the original's id, kind and size and the marks in
  `marked: { source, marks }` (none before marks, `serde(default)`): the original's files stay
  with the note (sweep, move, `note-image:`). Points in the image's pixels, whole; the label's
  size follows the image's longest side (`markSize`), the color is `--ui-mark`, the same in both
  themes.
- Frontend: `NoteImages` (thumbnails, viewer), `MarkEditor` (marks over the image fitted, a canvas
  at its size on screen; geometry in `model/marks.ts`), `Composer` (the waiting images, their object URLs
  revoked when added or left out), `useColumnImages` (drops, the target lit up). Thumbnails have
  their box before they load (`thumbBox`): a card's measured height never moves.

## Decisions

- Thumbnails made in Rust with `image` (the maintainer; `.local/note-thumbnails/`):
  10 cards showing 5K screenshots whole hold 1.1 GB in WebContent. A canvas in one step skips
  pixels (text unreadable); by halving it peaks ~250 MB in WebContent and ~195 MB in the GPU
  process and keeps part. `image`: a 5K screenshot in 115 ms, 84 MB peak, the same on every
  system. `fast_image_resize` gains nothing on RGBA screenshots; `jpeg-decoder`'s reduced decode
  (12 MP: 26 ms, 5 MB against 88 ms, 64 MB) is in maintenance mode and our JPEGs are rare: later,
  if photos matter.
- Thumbnails PNG, not JPEG: a window's screenshot has a transparent shadow.
- Images below the text, not inside it: no rich editor; a note stays plain text.
- A copy gives paths, not image bytes (the maintainer): one copy serves an agent in a
  terminal; "Copy image" serves a colleague.
- Marks (KISS: more on felt need): one object, one color; no rectangle, highlight,
  blur or crop. A secret, if ever, an opaque box: pixelated text can be recovered.
- A marked image drawn in the webview, not in Rust: the editor's code and font, so
  what is copied is what was seen. WKWebView, `.local/note-thumbnails/` (`mode=flatten`):
  2560x1664 in 130-210 ms, 5K in 400-600 ms with a transient peak of ~310 MB in WebContent and
  ~250 MB in the GPU process; once, on Done.
- A copy may ask the backend after the click: WKWebView writes the clipboard 0-3,000 ms after it
  (`.local/note-paste/`).
