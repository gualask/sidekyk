# Notes

Cards in lists, per project, stored in the app data directory (built 2026-10-17, tried in the app
2026-10-18). Sync: `../plans/notes-sync.md`.

## Behaviour

- Cards, not documents: plain text, user's order (new on top), each marked done when used. Done
  cards fold into "Done (n)".
- Actions on the card, never in its text: done circle left; copy and ⋯ top right. ⋯: move to top,
  reorder, move to another list, delete (move and delete undoable).
- Edit in place: four lines shown (line count if longer), all when clicked; `Esc`, `⌘↵` or click
  outside closes; an empty card goes (Undo). Long lines wrap or scroll (setting `noteLines`, `⌥Z`
  from a note).
- Field on top adds to the open list: `↵` adds, `⇧↵` new line, paste into the empty field adds at
  once; `⌘N` focuses it, from anywhere but all projects.
- Lists per project by topic; full screen on the left, in a tile a menu from the header. "New
  list" first; double click renames; deleting takes its notes (Undo). A project opens on the list
  last open.
- Order without drag and drop: "Move to top", and "Reorder…" (one line per card with ↑, position,
  ↓; a typed position for long jumps; `⌥↑`/`⌥↓` move, `↑`/`↓` select; `Esc`/`↵` leave). Done
  cards stay by when done.
- Export a project's notes to Markdown from the panel's ⋯ (never inside a repository). Removing a
  project with notes asks: export then remove, or delete; nothing is left on disk.
- Found by `⌘K` (`search.md`).

## How it is built

- Books (2026-10-23): the notes of one owner, a project or the Inbox. On the wire a string, the
  project's id or `inbox` (`INBOX_BOOK`; no project id can be it), made a `Book` (`Inbox |
  Project { id, name }`) in the interface, which refuses any other id. The Inbox has one list,
  made with it and never shown; the store refuses on it what only projects have (lists, done,
  order, Move list, deletion: programming errors, not user-facing codes).
- Storage: `<app data>/notes/<name>-<6 hex>/` per project, named after the project's name when
  first written, and `<app data>/notes/inbox/` (`io.github.gualask.sidekyk` under
  `~/Library/Application Support`, `~/.local/share`, `%APPDATA%`), never in repositories:
  `project.json` (the project's id; `root` before ids, the same value; none for the Inbox),
  `lists.json` (order), `state.json` (open list, this machine only) and one `<id>.json` per note
  (text, list, position, edited, done). Order by a number per note, a move takes the middle of its
  neighbors (renumbering the list only when no room is left). Layout in `modules/notes/store.rs`;
  folder by project id from each `project.json`, scanned once.
- The book read last stays in memory; a change writes only the files it touched (written
  beside, `sync_all`, renamed over; a leftover `.tmp` is removed when read), a failed write drops
  the memory copy. Nothing is written for a book until its first change; until then its first
  list has a fixed id, so the one the frontend was given is still there after another book was
  read. Ids: 16 hex digits, the only names let through to files.
- Moving (`move_note`, `move_list`, backend and port; the dialog is still to come): a note goes
  to another book, or another list of its own, with its id, on top of the list's open notes
  (`ListTarget`: the open list, a list, a new one); done stays done, but into the Inbox. A list
  goes to another project whole: into its list of the same name (case aside), its open notes
  below, else added last; the last list of a project stays. The book that takes is written first,
  so a failure between leaves the notes in both, never in neither (`NotesStore::exchange`; the
  book in memory stays, the other is read for the move). Undo: `unmove_note` puts the note back
  as it was, `unmove_list` brings the list back as a deleted one and takes its notes out of the
  other project, with the list made for them when nothing else is in it. A move to a new project
  (`BookTarget::NewProject`) makes it, without folder, in the interface, and removes it with
  what was written for it when the move fails; `projects-changed` tells the frontend.
- A note is at most 1 MiB (`note_too_long`); a missing note or list is `note_missing` /
  `note_list_missing`; a broken file is skipped and logged, never removed; a change that changes
  nothing writes nothing. A new folder never takes one in use (two projects of one name).
- Export (`export_notes`): Markdown (`to_markdown`: a section per list, notes between `---`, done
  ones under `### Done`) where the save dialog says, never inside a project's repository
  (`export_in_repository`; `ProjectList::holds`: paths resolved by the file system, links
  included, compared without case on macOS and Windows). The export reads the notes without
  replacing those in memory (`read_notes`).
- Removing a project deletes its notes first (`remove_project`; if they cannot go, the project
  stays). The frontend asks before (`RemoveProjectDialog`, notes module, lazy, from the overview's ⋯
  and the problems of a repository moved or a WSL distro gone): no notes (`count_notes`, files
  counted, nothing read), it goes at once; else export then remove, or remove and delete; a count
  that fails asks too.
- Frontend (`NotesWorkspace`): lists on the left full screen, cards of the open list (virtualized,
  measured heights), reorder mode. `useNotes` reads a book once (`['notes', book]`,
  never stale: only the app writes); `useNoteActions` changes the cache at once, then sends the
  change after those before it (`ChangeQueue`, per book: the backend gets them in order); only
  the last answer is shown, a skipped one makes the notes read again at the end, a failure too.
  Answers update notes in place (`withUpdated`), only add and restore add one. Undo undoes that
  change only (done, a move back to its place). A card saves its text 500 ms after typing stops
  and on close (blur: `Esc`, `⌘↵`, a click outside, not the window losing the focus). `noteLines`
  through `NotesSettingsProvider`; `⌥Z` in a note field: the key's letter, else its place when
  `⌥` types a symbol; the field's height follows. `⌘N` is the workspace's (also from a field):
  `show` to Notes with `newNoteTarget`.
- Caches of a book's notes are one family: `['notes', book]`, its card's summary (open, done,
  last edit) and its count below it; every change makes the summary stale, rereading or forgetting a project's notes
  takes all three. The backend's summary cache is read and filled under the same lock as changes.
- `notes_timings` (release, 1,000 notes): read 26 ms, a change 5 ms (mostly `sync_all`).

## Decisions

- One file per note (2026-10-17): a change writes one file, a sync conflict is one note.
- Removing a project never leaves its notes on disk (2026-10-17): it asks, export or delete.
