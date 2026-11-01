# Images in notes

A note holds text and, below it, images: pasted or dropped, shown as thumbnails, copied out as
paths for an agent (built 2026-11-01). The notes themselves: `notes.md`. What comes next on images
(annotate, capture): `../../.cflow/plans/capture.md`.

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
  files (`add_note_image_files`, a regular file within the limit).
- Out: `note-image://localhost/<book>/<file>` (`http://note-image.localhost/…` on Windows), the
  book and the file encoded as `project-file:`'s (`previews.md`); only a file a note of the book
  names, `immutable` (an id names its bytes). CSP `img-src` lists it. `copy_note` composes the
  copy; for WSL, `wslpath -u` of the notes' folder once per distro and session. `note_image_png`
  gives a non-PNG image as PNG for the clipboard (`ClipboardItem`).
- Frontend: `NoteImages` (thumbnails, viewer), `Composer` (the waiting images, their object URLs
  revoked when added or left out), `useColumnImages` (drops, the target lit up). Thumbnails have
  their box before they load (`thumbBox`): a card's measured height never moves.

## Decisions

- Thumbnails made in Rust with `image` (2026-11-01, the maintainer; `.local/note-thumbnails/`):
  10 cards showing 5K screenshots whole hold 1.1 GB in WebContent. A canvas in one step skips
  pixels (text unreadable); by halving it peaks ~250 MB in WebContent and ~195 MB in the GPU
  process and keeps part. `image`: a 5K screenshot in 115 ms, 84 MB peak, the same on every
  system. `fast_image_resize` gains nothing on RGBA screenshots; `jpeg-decoder`'s reduced decode
  (12 MP: 26 ms, 5 MB against 88 ms, 64 MB) is in maintenance mode and our JPEGs are rare: later,
  if photos matter.
- Thumbnails PNG, not JPEG: a window's screenshot has a transparent shadow.
- Images below the text, not inside it (2026-11-01): no rich editor; a note stays plain text.
- A copy gives paths, not image bytes (2026-11-01, the maintainer): one copy serves an agent in a
  terminal; "Copy image" serves a colleague.
- A copy may ask the backend after the click: WKWebView writes the clipboard 0-3,000 ms after it
  (`.local/note-paste/`).
